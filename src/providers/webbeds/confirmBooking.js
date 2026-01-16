import { WebbedsError } from "./client.js"
import {
  ensureSalutationsCacheWarm,
  getDefaultSalutationId,
  resolveSalutationId,
} from "./salutations.js"

import dayjs from "dayjs"

const DATE_FORMAT = (process.env.WEBBEDS_DATE_FORMAT || "YYYY-MM-DD").trim()

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return ["1", "true", "yes", "y"].includes(normalized)
  }
  return false
}

const formatDateValue = (value) => {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null
  const normalized = DATE_FORMAT.toLowerCase()
  if (["unix", "epoch", "seconds", "x"].includes(normalized)) {
    return Math.floor(parsed.valueOf() / 1000).toString()
  }
  return parsed.format(DATE_FORMAT)
}

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const getSalutation = (p) => {
  ensureSalutationsCacheWarm()

  const direct =
    resolveSalutationId(
      p.salutationId ?? p.salutation_id ?? p.salutationCode ?? p.salutation,
    ) ??
    resolveSalutationId(p.title) ??
    resolveSalutationId(p.type ?? p.passengerType)

  if (direct != null) return direct

  const fallbackRaw =
    process.env.WEBBEDS_DEFAULT_SALUTATION_ID ??
    process.env.WEBBEDS_SALUTATION_DEFAULT

  return resolveSalutationId(fallbackRaw) ?? getDefaultSalutationId()
}

const buildPassengersDetails = (passengers = []) => {
  const entries = ensureArray(passengers)
  if (!entries.length) return null
  const isLeading = (value, idx) => {
    if (value === true) return true
    if (value === false || value == null) return idx === 0
    const normalized = String(value).trim().toLowerCase()
    if (["yes", "y", "true", "1"].includes(normalized)) return true
    if (["no", "n", "false", "0"].includes(normalized)) return false
    return idx === 0
  }
  return {
    passenger: entries.map((p, idx) => ({
      salutation: getSalutation(p),
      firstName: p.firstName || p.givenName || "Guest",
      lastName: p.lastName || p.surname || "Name",
      "@leading": isLeading(p.leading, idx) ? "yes" : "no",
    })),
  }
}

const buildRoomsNode = ({
  rooms = [],
  nationality,
  residence,
  passengers = [],
  customerReference,
}) => {
  const roomEntries = ensureArray(rooms)
  if (!roomEntries.length) {
    throw new Error("WebBeds confirmbooking requires at least one room")
  }
  let passengerCursor = 0

  return {
    "@no": String(roomEntries.length),
    room: roomEntries.map((room, idx) => {
      const children = ensureArray(room.children || room.childrenAges || room.kids)
        .map((age) => (age == null ? null : String(age)))
        .filter((age) => age !== null && age !== undefined && age !== "")

      const childrenNode = { "@no": String(children.length) }
      if (children.length) {
        childrenNode["#raw"] = children
          .map((age, childIdx) => `<child runno="${childIdx}">${String(age)}</child>`)
          .join("")
      }
      const actualChildrenAges = ensureArray(
        room.actualChildren ||
        room.actualChildrenAges ||
        room.actualKids ||
        room.actualChildrenAge ||
        room.actualChildrenAges,
      ).map((age) => (age == null ? null : String(age)))
        .filter((age) => age !== null && age !== undefined && age !== "")
      const actualChildrenResolved = actualChildrenAges.length ? actualChildrenAges : children
      const actualChildrenNode = { "@no": String(actualChildrenResolved.length) }
      if (actualChildrenResolved.length) {
        actualChildrenNode["#raw"] = actualChildrenResolved
          .map((age, childIdx) => `<actualChild runno="${childIdx}">${String(age)}</actualChild>`)
          .join("")
      }

      // Distribución de pasajeros por room, consistente con saveBooking
      // Nota: passengers aquí ya puede venir pre-split por room (room.passengers)
      let roomPassengers = []
      if (room.passengers) {
        roomPassengers = room.passengers
      } else {
        // fallback: repartir por adultos usando el cursor global
        const neededAdults = Math.max(
          1,
          toNumber(room.actualAdults) || toNumber(room.adults) || 1,
        )
        const actualChildrenAges = ensureArray(
          room.actualChildren ||
          room.actualChildrenAges ||
          room.actualKids ||
          room.actualChildrenAge ||
          room.actualChildrenAges ||
          room.children ||
          room.childrenAges ||
          room.kids,
        ).map((age) => toNumber(age)).filter((age) => Number.isFinite(age))
        const neededTotal = neededAdults + actualChildrenAges.length
        const slice = passengers.slice(passengerCursor, passengerCursor + neededTotal)
        passengerCursor += neededTotal
        const placeholders = Array.from({ length: Math.max(0, neededTotal - slice.length) }).map((_, i) => ({
          firstName: "Guest",
          lastName: `R${idx + 1}P${i + 1}`,
          leading: false,
        }))
        roomPassengers = [...slice, ...placeholders]
      }

      // Asegura al menos un leading="yes" por room
      const hasLeading = roomPassengers.some(
        (pax) => String(pax.leading).trim().toLowerCase() === "yes" || pax.leading === true,
      )
      if (!hasLeading && roomPassengers.length) {
        roomPassengers[0] = { ...roomPassengers[0], leading: "yes" }
      }
      roomPassengers = roomPassengers.map((pax, paxIdx) => {
        if (paxIdx === 0 && String(pax.leading).trim().toLowerCase() === "yes") return pax
        if (pax.leading === undefined) return { ...pax, leading: "no" }
        return pax
      })

      const paxNode = buildPassengersDetails(roomPassengers)

      return {
        "@runno": String(idx),
        roomTypeCode: room.roomTypeCode || "0",
        selectedRateBasis: room.selectedRateBasis || "0",
        allocationDetails: room.allocationDetails || "",
        adultsCode: String(Math.max(1, toNumber(room.adults) || 1)),
        actualAdults: String(
          Math.max(1, toNumber(room.actualAdults) || toNumber(room.adults) || 1),
        ),
        children: childrenNode,
        actualChildren: actualChildrenNode,
        extraBed: String(room.extraBed != null ? room.extraBed : 0),
        passengerNationality: room.nationality || nationality || null,
        passengerCountryOfResidence: room.residence || residence || null,
        customerReference: customerReference || null,
        passengersDetails: paxNode,
      }
    }),
  }
}

export const buildConfirmBookingPayload = ({
  bookingCode,
  bookingId,
  parent,
  addToBookedItn,
  bookedItnParent,
  fromDate,
  toDate,
  currency = "520",
  productId,
  rooms,
  passengers = [],
  contact = {},
  customerReference,
} = {}) => {
  const code = bookingCode || bookingId
  if (!code) {
    throw new Error("WebBeds confirmbooking requires bookingCode (or bookingId)")
  }

  const from = formatDateValue(fromDate)
  const to = formatDateValue(toDate)
  if (!from || !to) {
    throw new Error("WebBeds confirmbooking requires valid fromDate/toDate")
  }
  const product = productId != null ? String(productId).trim() : null
  if (!product || !/^\d+$/.test(product)) {
    throw new Error("WebBeds confirmbooking requires productId (hotelId)")
  }

  const roomsNode = buildRoomsNode({
    rooms,
    nationality: rooms?.[0]?.nationality,
    residence: rooms?.[0]?.residence,
    passengers,
    customerReference,
  })

  const bookingDetails = {
    bookingCode: String(code),
    fromDate: from,
    toDate: to,
    currency: currency || "520",
    productId: product,
    rooms: roomsNode,
  }
  if (parent) bookingDetails.parent = String(parent)
  if (addToBookedItn !== undefined) bookingDetails.addToBookedItn = String(addToBookedItn)
  if (bookedItnParent) bookingDetails.bookedItnParent = String(bookedItnParent)
  if (customerReference) bookingDetails.customerReference = customerReference
  if (contact?.email) bookingDetails.sendCommunicationTo = contact.email

  return { bookingDetails }
}

export const mapConfirmBookingResponse = (result) => {
    const bookingDetails = result?.bookingDetails ?? {}

    return {
        successful: normalizeBoolean(result?.successful),
        bookingId: bookingDetails.bookingId ?? null,
        status: bookingDetails.status ?? null,
        voucher: bookingDetails.voucher ?? null,
        reference: bookingDetails.reference ?? null,
        currency: bookingDetails.currency ?? null,
        totalPrice: bookingDetails.totalPrice ?? null,
        metadata: {
            command: result?.["@_command"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
            time: result?.["@_time"] ?? null,
            version: result?.["@_version"] ?? null,
        },
    }
}
