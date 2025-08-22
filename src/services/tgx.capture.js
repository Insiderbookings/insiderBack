// src/services/tgx.capture.js
import fs from "fs"
import path from "path"
import { print } from "graphql" // para serializar AST gql a string

const CAPTURE_ENABLED = process.env.TGX_CERT_MODE === "true"        // true/false
const CAPTURE_TAG     = process.env.CERT_CAPTURE                    // "rf" | "nrf" | "direct"
const OUT_DIR         = process.env.TGX_CERT_OUT_DIR || "cert"      // carpeta destino

/** Devuelve la ruta absoluta a la carpeta de salida y la crea si no existe */
function ensureOutDir() {
  const dir = path.resolve(process.cwd(), OUT_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Si doc es AST (gql), lo imprime; si es string, lo devuelve tal cual */
function toQueryString(doc) {
  if (!doc) return ""
  if (typeof doc === "string") return doc
  try { return print(doc) } catch { return String(doc) }
}

/**
 * Captura RQ/RS de una operación TGX para certificación.
 *
 * @param {string}   op        - "search" | "quote" | "book" | "cancel" | "hotels"
 * @param {Object}   vars      - variables del request (variables GraphQL)
 * @param {Function} doRequest - callback que ejecuta la petición y devuelve la promesa (ej: () => client.request(doc, vars))
 * @param {Object}   options   - { doc, onlyRS=false }
 *   - doc: el documento GraphQL (AST o string) para serializar el RQ
 *   - onlyRS: si true, no escribe el RQ (se fuerza en "hotels" aunque pases false)
 */
export async function requestWithCapture(op, vars, doRequest, { doc, onlyRS = false } = {}) {
  // Si no estamos en modo captura, ejecuta y devuelve sin tocar archivos
  const shouldCapture = CAPTURE_ENABLED && !!CAPTURE_TAG && !!op
  const outDir = shouldCapture ? ensureOutDir() : null

  // "hotels" no requiere RQ según la guía de TGX
  const skipRQ = op === "hotels" || onlyRS === true
  const base   = shouldCapture ? `${op}_${CAPTURE_TAG}` : null
  const rqName = shouldCapture ? (skipRQ ? null : `rq_${base}.json`) : null
  const rsName = shouldCapture ? (op === "hotels" ? "rs_hotels.json" : `rs_${base}.json`) : null

  // Helper: escribe el RQ
  const writeRQ = () => {
    if (!shouldCapture || !rqName) return
    const rqBody = { query: toQueryString(doc), variables: vars }
    fs.writeFileSync(path.join(outDir, rqName), JSON.stringify(rqBody, null, 2))
  }

  // Helper: formatea el RS en envoltorio GraphQL { data, errors }
  const wrapData = (payload) => (payload && typeof payload === "object" && "data" in payload)
    ? payload
    : { data: payload }

  const writeRS = (payload) => {
    if (!shouldCapture || !rsName) return
    const rsBody = wrapData(payload)
    fs.writeFileSync(path.join(outDir, rsName), JSON.stringify(rsBody, null, 2))
  }

  try {
    const res = await doRequest()
    // Captura OK
    if (shouldCapture) {
      if (!skipRQ) writeRQ()
      writeRS(res)
    }
    return res
  } catch (err) {
    // Captura también en error (útil para debugging/cert)
    if (shouldCapture) {
      if (!skipRQ) writeRQ()

      // Normalizamos error a forma GraphQL
      const gqlErrors = err?.response?.errors
        ? err.response.errors
        : [{ message: err?.message || "Unknown error", ...(err?.stack ? { stack: err.stack } : {}) }]

      const rsErrorBody = {
        data: null,
        errors: gqlErrors,
        // opcionalmente puedes incluir el status/headers si los expone el cliente:
        ...(err?.response?.status ? { status: err.response.status } : {}),
        ...(err?.response?.headers ? { headers: err.response.headers } : {}),
      }
      writeRS(rsErrorBody)
    }
    throw err
  }
}
