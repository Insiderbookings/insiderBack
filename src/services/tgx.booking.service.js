/*********************************************************************************************
 * src/services/tgx.booking.service.js
 * TravelgateX — Quote · Book · Cancel services
 * - Client singleton con GraphQLRequest
 * - Retries con backoff exponencial para errores de red
 * - Captura de RQ/RS para certificación (TGX_CERT_MODE=true y CERT_CAPTURE=rf|nrf|direct)
 *   -> genera: rq_quote_*.json / rs_quote_*.json / rq_book_*.json / rs_book_*.json / rq_cancel_*.json / rs_cancel_*.json
 *********************************************************************************************/

import { GraphQLClient, gql } from "graphql-request"
import { requestWithCapture } from "./tgx.capture.js"

/* ---------- helper: client singleton ---------- */
let _client
function tgxClient() {
  if (_client) return _client
  const endpoint = process.env.TGX_ENDPOINT || "https://api.travelgate.com"
  _client = new GraphQLClient(endpoint, {
    headers: {
      Authorization: `ApiKey ${process.env.TGX_KEY}`,
      "User-Agent": "InsiderBookings/1.0",
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip",
      Connection: "keep-alive",
    },
    timeout: 30_000,
  })
  return _client
}

/* ---------- retry helper (backoff exponencial para errores de red) ---------- */
async function requestWithRetry(doc, variables, { attempts = 3, baseDelayMs = 700 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await tgxClient().request(doc, variables)
    } catch (err) {
      lastErr = err
      const code = err?.cause?.code || err?.code
      const netErrs = ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CONNECT", "ECONNRESET", "ETIMEDOUT"]
      const isNetErr = netErrs.includes(code)
      if (!isNetErr || i === attempts - 1) throw err
      const delay = baseDelayMs * (2 ** i) // 700ms, 1400ms, 2800ms
      console.warn(`[TGX] Network error (${code}). Retry ${i + 1}/${attempts} in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

/* ---------- Fragments ---------- */
const PRICE_FRAGMENT = `
  price {
    currency
    net
    gross
    binding
  }
`

/* ================================== QUOTE ================================== */

const QUOTE_Q = gql`
  query ($input: HotelCriteriaQuoteInput!, $settings: HotelSettingsInput!) {
    hotelX {
      quote(criteria: $input, settings: $settings) {
        optionQuote {
          optionRefId
          status
          ${PRICE_FRAGMENT}
          searchPrice { currency net gross binding }
          rooms {
            code
            refundable
          }
          
        }
        errors   { code type description }
        warnings { code type description }
      }
    }
  }
`


export async function quoteTGX(rateKey, settings) {
  const vars = { input: { optionRefId: rateKey }, settings }
  const exec = () => requestWithRetry(QUOTE_Q, vars, { attempts: 2 })

  // Siempre pasamos por el capturador; si no está habilitado, no escribe archivos.
  const data = await requestWithCapture("quote", vars, exec, { doc: QUOTE_Q })

  const payload = data?.hotelX?.quote
  if (payload?.errors?.length) {
    throw new Error(`Quote error: ${payload.errors[0].description}`)
  }
  return payload?.optionQuote
}

/* =================================== BOOK =================================== */
/* Importante:
   - NO enviar 'email' en holder (solo name, surname). Si necesitás el mail, adjúntalo en remarks.
   - cancelPolicy se pide UNA sola vez con sus subcampos (debajo). */

const BOOK_MUT = gql`
  mutation ($input: HotelBookInput!, $settings: HotelSettingsInput!) {
    hotelX {
      book(input: $input, settings: $settings) {
        booking {
          status
          reference { bookingID client supplier hotel }
          price { currency net gross binding }
          holder { name surname }
          cancelPolicy {
            refundable
            cancelPenalties {
              deadline
              isCalculatedDeadline
              penaltyType
              currency
              value
            }
          }
          hotel {
            hotelCode
            hotelName
            bookingDate
            start
            end
            boardCode
            occupancies { id paxes { age } }
            rooms {
              code
              description
              occupancyRefId
              price { currency binding net gross }
            }
          }
          remarks
        }
        errors   { code type description }
        warnings { code type description }
      }
    }
  }
`
/**
 * Realiza la reserva en TGX.
 * Recomendación durante certificación: activar auditTransactions para trazabilidad.
 */
export async function bookTGX(input, settings) {
  const vars = {
    input,
    settings: { ...settings, auditTransactions: true },
  }
  const exec = () => requestWithRetry(BOOK_MUT, vars, { attempts: 3 })

  const data = await requestWithCapture("book", vars, exec, { doc: BOOK_MUT })

  const payload = data?.hotelX?.book
  if (payload?.errors?.length) {
    throw new Error(`Booking error: ${payload.errors[0].description}`)
  }
  return payload?.booking
}

/* ================================== CANCEL ================================== */
/* IMPORTANTE:
   - El input es HotelCancelInput (bookingID o { accessCode, hotelCode, reference }) */

const CANCEL_MUT = gql`
  mutation CancelBooking($input: HotelCancelInput!, $settings: HotelSettingsInput!) {
    hotelX {
      cancel(input: $input, settings: $settings) {
        errors   { type code description }
        warnings { code description }
        cancellation {
          status
          cancelReference
          reference { bookingID client supplier hotel }
        }
      }
    }
  }
`;


export async function cancelTGX(bookingIDOrObj, settings) {
  const input =
    typeof bookingIDOrObj === "string"
      ? { bookingID: bookingIDOrObj.trim() }
      : bookingIDOrObj

  // ayuda durante cert: deja trazas en audit
  const vars = { input, settings: { ...settings, auditTransactions: true } }
  const exec = () => requestWithRetry(CANCEL_MUT, vars, { attempts: 2 })

  const data = await requestWithCapture("cancel", vars, exec, { doc: CANCEL_MUT })
  const payload = data?.hotelX?.cancel
  if (payload?.errors?.length) {
    throw new Error(`Cancel error: ${payload.errors[0].description}`)
  }
  return payload?.cancellation   // ← devuelve todo el objeto cancellation (con status)
}