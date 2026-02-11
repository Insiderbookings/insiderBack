const toNumberOr = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const toBooleanOr = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  const normalized = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

export const getWebbedsConfig = (overrides = {}) => {
  const {
    WEBBEDS_USERNAME,
    WEBBEDS_PASSWORD_MD5,
    WEBBEDS_PASSWORD,
    WEBBEDS_COMPANY_ID,
    WEBBEDS_HOST,
    WEBBEDS_TIMEOUT_MS,
    WEBBEDS_RETRIES,
    WEBBEDS_RETRY_BASE_DELAY_MS,
    WEBBEDS_RETRY_MAX_DELAY_MS,
    WEBBEDS_IP_FAMILY,
    WEBBEDS_COMPRESS_REQUESTS,
  } = process.env
  const parsedIpFamily = toNumberOr(WEBBEDS_IP_FAMILY, null)

  const config = {
    username: overrides.username ?? WEBBEDS_USERNAME,
    passwordMd5: overrides.passwordMd5 ?? WEBBEDS_PASSWORD_MD5,
    password: overrides.password ?? WEBBEDS_PASSWORD,
    companyCode: overrides.companyCode ?? WEBBEDS_COMPANY_ID,
    host: overrides.host ?? WEBBEDS_HOST ?? "https://xmldev.dotwconnect.com",
    timeoutMs: overrides.timeoutMs ?? toNumberOr(WEBBEDS_TIMEOUT_MS, 30000),
    retries: overrides.retries ?? toNumberOr(WEBBEDS_RETRIES, 2),
    retryBaseDelayMs:
      overrides.retryBaseDelayMs ?? toNumberOr(WEBBEDS_RETRY_BASE_DELAY_MS, 400),
    retryMaxDelayMs:
      overrides.retryMaxDelayMs ?? toNumberOr(WEBBEDS_RETRY_MAX_DELAY_MS, 2500),
    ipFamily:
      overrides.ipFamily ?? ((parsedIpFamily === 4 || parsedIpFamily === 6) ? parsedIpFamily : undefined),
    preferCompressedRequests:
      overrides.preferCompressedRequests ??
      toBooleanOr(WEBBEDS_COMPRESS_REQUESTS, false),
  }

  if (!config.username) throw new Error("Missing WebBeds username (WEBBEDS_USERNAME)")
  if (!config.companyCode) throw new Error("Missing WebBeds company code (WEBBEDS_COMPANY_ID)")
  if (!config.host) throw new Error("Missing WebBeds host (WEBBEDS_HOST)")

  return config
}
