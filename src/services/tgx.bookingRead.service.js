/*********************************************************************************************
 * src/services/tgx.bookingRead.service.js
 * TravelgateX — Booking Read service
 * Reutiliza el cliente y la lógica de retry/capture de tgx.booking.service.js
 *********************************************************************************************/

import { gql } from "graphql-request"
import { requestWithCapture } from "./tgx.capture.js"
import { requestWithRetry } from "./tgx.booking.service.js"

/** ✅ Query correcta: usa HotelCriteriaBookingInput y variable criteriaBookingRead */
const BOOKING_READ_Q = gql`
  query ($criteriaBookingRead: HotelCriteriaBookingInput!, $settings: HotelSettingsInput!) {
    hotelX {
      booking(criteria: $criteriaBookingRead, settings: $settings) {
        bookings {
          status
          reference { bookingID client supplier hotel }
          price { currency net gross binding }
          holder { name surname }
          hotel {
            hotelCode
            hotelName
            bookingDate
            start
            end
            boardCode
            rooms {
              code
              description
              occupancyRefId
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

/** 🔧 Normaliza posibles bookingID con caracteres/formatos indeseados */
const normalizeBookingID = (id) =>
  String(id || "")
    .trim()                    // espacios al borde
    .replace(/\s+/g, "")       // espacios intermedios
    .replace(/[\u200B\u200E\uFEFF]/g, "") // invisibles comunes
    .replace(/\[$/, "")        // '[' colgante al final (caso frecuente)

/** Construye variables para lectura por ID */
const buildVarsById = (id, settings) => ({
  criteriaBookingRead: { bookingID: normalizeBookingID(id) },
  settings,
})

/**
 * Construye variables para lectura por referencias (REFERENCES)
 * Requisitos (según spec):
 *  - accessCode
 *  - references: [{ client? | supplier? }]
 *  - hotelCode (obligatorio para REFERENCES)
 *  - currency recomendado (EUR por defecto)
 *  - language opcional (default "es")
 *
 * Nota: No mezclar con dates; si querés buscar por rango, usar DATES.
 */
const buildVarsByRefs = (c = {}, settings) => {
  const { accessCode, reference = {}, hotelCode, hotel, currency, language } = c
  if (!accessCode || !(reference.client || reference.supplier)) {
    throw new Error("Para buscar por referencias: accessCode y (reference.client o reference.supplier)")
  }
  const hCode = String(hotelCode || reference.hotel || hotel || "").trim()
  if (!hCode) {
    throw new Error("Para buscar por referencias: hotelCode requerido por la spec")
  }
  return {
    criteriaBookingRead: {
      accessCode: String(accessCode),
      typeSearch: "REFERENCES",
      references: {
        hotelCode: hCode,
        currency : String(currency || "EUR").toUpperCase(),
        references: [
          {
            ...(reference.client   ? { client:   String(reference.client) }   : {}),
            ...(reference.supplier ? { supplier: String(reference.supplier) } : {}),
          },
        ],
      },
      language: language || "es",
    },
    settings,
  }
}

/**
 * Construye variables para listado por fechas (DATES)
 * Requisitos:
 *  - accessCode
 *  - start
 *  - end
 */
const buildVarsByDates = (c = {}, settings) => {
  const { accessCode, start, end, language } = c
  if (!accessCode || !start || !end) {
    throw new Error("Para buscar por fechas: accessCode, start y end son requeridos")
  }
  return {
    criteriaBookingRead: {
      accessCode: String(accessCode),
      typeSearch: "DATES",
      dates: { dateType: "ARRIVAL", start, end },
      language: language || "es",
    },
    settings,
  }
}

/**
 * Lee una reserva en TGX.
 * - Si viene bookingID: intenta por ID.
 * - Si viene accessCode + references (y hotelCode): intenta por REFERENCES.
 * - Si viene accessCode + start + end: intenta por DATES.
 * Retorna: { errors: [], warnings: [], bookings: [] }
 */
export async function readBookingTGX(criteria, settings) {
  const c = typeof criteria === "string" ? { bookingID: criteria.trim() } : (criteria || {})

  // Orden de intentos según lo que tengamos disponible
  const tryOrder = []
  if (c.bookingID) tryOrder.push("ID")
  if (c.accessCode && (c.reference?.client || c.reference?.supplier)) tryOrder.push("REFS")
  if (c.accessCode && c.start && c.end) tryOrder.push("DATES")

  if (tryOrder.length === 0) {
    throw new Error("bookingID válido o (accessCode + references) o (accessCode + start/end) requeridos")
  }

  // Helper para ejecutar con capture + retry
  const run = async (vars, label = "bookingRead") => {
    const exec = () => requestWithRetry(BOOKING_READ_Q, vars, { attempts: 2 })
    const data = await requestWithCapture(label, vars, exec, { doc: BOOKING_READ_Q })
    const payload = data?.hotelX?.booking || {}
    return {
      errors: payload.errors || [],
      warnings: payload.warnings || [],
      bookings: payload.bookings || [],
    }
  }

  // Intento principal
  try {
    const vars =
      tryOrder[0] === "ID"    ? buildVarsById(c.bookingID, settings) :
      tryOrder[0] === "REFS"  ? buildVarsByRefs(c, settings) :
                                buildVarsByDates(c, settings)
    return await run(vars, `bookingRead:${tryOrder[0].toLowerCase()}`)
  } catch (err) {
    // Fallbacks en el orden disponible
    for (let i = 1; i < tryOrder.length; i++) {
      try {
        const next = tryOrder[i]
        const vars =
          next === "ID"   ? buildVarsById(c.bookingID, settings) :
          next === "REFS" ? buildVarsByRefs(c, settings) :
                            buildVarsByDates(c, settings)
        return await run(vars, `bookingRead:${next.toLowerCase()}`)
      } catch (_) {
        // intenta el siguiente
      }
    }
    // Si todos fallan, escalo el primero
    throw err
  }
}
