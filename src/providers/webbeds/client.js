import axios from "axios"
import { createHash } from "crypto"
import builder from "xmlbuilder"
import { XMLParser } from "fast-xml-parser"
import { gzip as gzipCallback, gunzip as gunzipCallback } from "zlib"
import { promisify } from "util"

const gzip = promisify(gzipCallback)
const gunzip = promisify(gunzipCallback)

class WebbedsError extends Error {
  constructor(message, {
    command,
    httpStatus,
    code,
    details,
    extraDetails,
    requestXml,
    responseXml,
    metadata,
  } = {}) {
    super(message)
    this.name = "WebbedsError"
    this.command = command
    this.httpStatus = httpStatus
    this.code = code
    this.details = details
    this.extraDetails = extraDetails
    this.requestXml = requestXml
    this.responseXml = responseXml
    this.metadata = metadata
  }
}

const verboseLogs = process.env.WEBBEDS_VERBOSE_LOGS === "true"
const noop = () => {}
const defaultLogger = {
  debug: verboseLogs ? (...args) => console.debug(...args) : noop,
  info: verboseLogs ? (...args) => console.info(...args) : noop,
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
})

const maskSensitiveXml = (xml) => {
  if (!xml) return xml
  return xml.replace(/(<password>)(.*?)(<\/password>)/i, "$1***redacted***$3")
}

const summarizeHeaders = (headers = {}) => {
  const important = ["Content-Encoding", "Accept-Encoding", "Content-Length"]
  return important.reduce((acc, key) => {
    if (headers[key]) acc[key] = headers[key]
    return acc
  }, {})
}

const formatAttemptLabel = (attempt, useCompression) =>
  `Attempt ${attempt}${useCompression ? " (gzip)" : " (plain)"}`

const buildPreview = (text, limit = 800) => {
  if (!text) return text
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

const ensureMd5Password = ({ passwordMd5, passwordPlain }) => {
  if (passwordMd5) return passwordMd5
  if (!passwordPlain) {
    throw new Error("WebBeds password is required (pass MD5 hash or plain password)")
  }
  return createHash("md5").update(passwordPlain).digest("hex")
}

const buildEnvelope = ({
  username,
  passwordMd5,
  companyCode,
  command,
  product = "hotel",
  payload = {},
  requestAttributes = {},
}) => {
  if (payload && typeof payload !== "object") {
    throw new Error("WebBeds payload must be an object representing <request> children")
  }

  const customer = {
    username,
    password: passwordMd5,
    id: companyCode,
    source: "1",
  }

  // XSD order matters for most commands: <product> must appear before <request>.
  if (product) customer.product = product

  customer.request = {
    "@command": command,
    ...Object.entries(requestAttributes || {}).reduce((acc, [key, value]) => {
      if (value != null) {
        acc[`@${key}`] = value
      }
      return acc
    }, {}),
    ...payload,
  }

  const document = { customer }

  return builder
    .create(document, { version: "1.0", encoding: "UTF-8" })
    .end({ pretty: false })
}

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    return value.trim().toUpperCase() === "TRUE"
  }
  return false
}

const parseResponse = (xml) => {
  const parsed = parser.parse(xml)
  const result = parsed?.result
  if (!result) {
    throw new WebbedsError("Invalid WebBeds response: missing <result> root", {
      responseXml: xml,
    })
  }

  const metadata = {
    command: result["@_command"],
    transactionId: result["@_tID"],
    elapsedTime: result["@_elapsedTime"],
    ip: result["@_ip"],
    timestamp: result["@_date"],
  }

  const successfulNode = result.request?.successful ?? result.successful
  const successful = normalizeBoolean(successfulNode)

  if (!successful) {
    const errorNode = result.request?.error ?? result.error ?? {}
    const errorDetails = {
      code: errorNode.code,
      details: errorNode.details,
      extraDetails: errorNode.extraDetails,
    }
    throw new WebbedsError("WebBeds request failed", {
      command: metadata.command,
      code: errorDetails.code,
      details: errorDetails.details,
      extraDetails: errorDetails.extraDetails,
      responseXml: xml,
      metadata,
    })
  }

  return { result, metadata, xml }
}

export const createWebbedsClient = ({
  username,
  passwordMd5,
  password,
  companyCode,
  host,
  endpointPath = "/gatewayV4.dotw",
  product = "hotel",
  timeoutMs = 30000,
  retries = 2,
  preferCompressedRequests = false,
  logger = defaultLogger,
  axiosInstance = axios,
} = {}) => {
  if (!username) throw new Error("WebBeds username is required")
  if (!companyCode) throw new Error("WebBeds company code is required")
  if (!host) throw new Error("WebBeds host is required (e.g. https://xmldev.dotwconnect.com)")

  const passwordHash = ensureMd5Password({
    passwordMd5,
    passwordPlain: password,
  })

  const normalizedHost = host.startsWith("http")
    ? host
    : `https://${host}`

  const baseUrl = normalizedHost.endsWith(endpointPath)
    ? normalizedHost
    : `${normalizedHost.replace(/\/+$/, "")}${endpointPath}`

  const requestWithRetry = async (attemptFn) => {
    let attempt = 0
    let lastError
    const maxAttempts = Math.max(1, Number.isFinite(retries) ? retries + 1 : 1)

    while (attempt < maxAttempts) {
      try {
        return await attemptFn(attempt)
      } catch (error) {
        lastError = error
        const isNetworkError = error.code === "ECONNABORTED" || error.code === "ENOTFOUND" || error.code === "ECONNRESET"
        const shouldRetry = attempt + 1 < maxAttempts && (
          isNetworkError
          || (error.response && error.response.status >= 500)
          || (error.httpStatus && error.httpStatus >= 500)
        )

        if (!shouldRetry) throw error

        logger.warn(`[webbeds] retrying request (attempt ${attempt + 2}/${maxAttempts})`, {
          code: error.code,
          message: error.message,
        })
      }
      attempt += 1
    }

    throw lastError
  }

  const attemptSend = async ({
    command,
    payload,
    requestAttributes,
    requestId,
    timeout,
    useCompression,
    logContext,
    productOverride,
  }) => {
    const computedProduct = productOverride !== undefined ? productOverride : product

    const envelopeXml = buildEnvelope({
      username,
      passwordMd5: passwordHash,
      companyCode,
      command,
      product: computedProduct,
      payload,
      requestAttributes,
    })

    if (logContext && !logContext.requestLogged) {
      logger.info("[webbeds] request snapshot", {
        command,
        payload,
        requestXml: maskSensitiveXml(envelopeXml),
      })
      logContext.requestLogged = true
    }

    const requestBody = useCompression
      ? await gzip(envelopeXml)
      : Buffer.from(envelopeXml, "utf8")

    const xmlBytes = Buffer.byteLength(envelopeXml, "utf8")
    const gzBytes = requestBody.length

    const startedAt = Date.now()

    return requestWithRetry(async (attempt) => {
      const attemptStart = Date.now()
      const attemptNumber = attempt + 1
      const attemptLabel = formatAttemptLabel(attemptNumber, useCompression)

      const requestConfig = {
        method: "POST",
        url: baseUrl,
        data: requestBody,
        responseType: "arraybuffer",
        timeout: timeout ?? timeoutMs,
        headers: {
          "Content-Type": "text/xml",
          Accept: "text/xml",
          "Accept-Encoding": "gzip",
          ...(useCompression ? { "Content-Encoding": "gzip" } : {}),
          Connection: "close",
          "Content-Length": String(requestBody.length),
          ...(requestId ? { "X-Request-Id": requestId } : {}),
        },
        transformRequest: [(data) => data],
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        proxy: false,
        decompress: true,
        validateStatus: () => true,
      }

      logger.info(`[webbeds] ${attemptLabel} start`, {
        xmlBytes,
        bodyBytes: gzBytes,
        headers: summarizeHeaders(requestConfig.headers),
      })

      const response = await axiosInstance.request(requestConfig)

      const attemptDuration = Date.now() - attemptStart
      const { status, statusText, headers } = response
      const isSuccessStatus = status >= 200 && status < 300
      const headerTid = headers["x-dotw-tid"]

      if (!isSuccessStatus) {
        const rawPreview = Buffer.isBuffer(response.data)
          ? response.data.toString("utf8").slice(0, 2000)
          : String(response.data ?? "").slice(0, 2000)
        logger.error(`[webbeds] ${attemptLabel} HTTP error`, {
          status,
          statusText,
          tID: headerTid,
          responsePreview: rawPreview,
        })
        throw new WebbedsError(`WebBeds HTTP error (${status}) ${statusText}`, {
          command,
          httpStatus: status,
          requestXml: envelopeXml,
          responseXml: rawPreview,
        })
      }

      let responseBuffer = Buffer.from(response.data)
      const encoding = headers["content-encoding"]
      if (encoding && encoding.toLowerCase().includes("gzip")) {
        logger.info(`[webbeds] ${attemptLabel} response compressed`, {
          contentEncoding: encoding,
          compressedBytes: responseBuffer.length,
        })
        responseBuffer = await gunzip(responseBuffer)
        logger.info(`[webbeds] ${attemptLabel} response decompressed`, {
          decompressedBytes: responseBuffer.length,
        })
      }

      const responseXml = responseBuffer.toString("utf8")
      let parsedPayload
      try {
        parsedPayload = parseResponse(responseXml)
      } catch (error) {
        logger.warn(`[webbeds] ${attemptLabel} result (failed)`, {
          tID: headerTid,
          httpStatus: status,
          details: error.details || error.message,
          code: error.code,
          responsePreview: buildPreview(responseXml),
        })
        throw error
      }

      const { result, metadata } = parsedPayload

      const totalDuration = Date.now() - startedAt
      const hotelsNode = result?.hotels?.hotel
      const hotelCount = Array.isArray(hotelsNode) ? hotelsNode.length : hotelsNode ? 1 : 0
      logger.info(`[webbeds] ${attemptLabel} result`, {
        tID: metadata.transactionId ?? headerTid,
        httpStatus: status,
        elapsedTime: metadata.elapsedTime,
        hotels: hotelCount,
        responsePreview: buildPreview(responseXml),
      })

      logger.info("[webbeds] request completed", {
        command,
        requestId,
        attempt: attemptNumber,
        httpStatus: status,
        tID: metadata.transactionId,
        elapsedTime: metadata.elapsedTime,
        durationMs: totalDuration,
        attemptDurationMs: attemptDuration,
      })

      return {
        result,
        metadata,
        requestXml: envelopeXml,
        responseXml,
        durationMs: totalDuration,
      }
    })
  }

  const isTransportParseError = (error) => {
    const details = `${error.details ?? ""} ${error.extraDetails ?? ""}`.toLowerCase()
    return (
      error instanceof WebbedsError &&
      error.code === "0" &&
      (details.includes("no xml") ||
        details.includes("invalid") ||
        details.includes("not well formatted"))
    )
  }

  const send = async (command, payload = {}, { requestId, timeout, requestAttributes, productOverride } = {}) => {
    if (!command) {
      throw new Error("WebBeds command is required")
    }

    const logContext = { requestLogged: false }

    try {
      return await attemptSend({
        command,
        payload,
        requestAttributes,
        requestId,
        timeout,
        useCompression: preferCompressedRequests,
        logContext,
        productOverride,
      })
    } catch (error) {
      if (isTransportParseError(error)) {
        logger.warn("[webbeds] transport parse error", {
          attemptedCompression: preferCompressedRequests,
          message: error.message,
          details: error.details,
          hint: "Toggle WEBBEDS_COMPRESS_REQUESTS to retry without gzip.",
        })
      }
      throw error
    }
  }

  return { send }
}

export { WebbedsError, buildEnvelope, parseResponse }
