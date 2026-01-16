import dayjs from "dayjs"
import {
  ensureSalutationsCacheWarm,
  getDefaultSalutationId,
  resolveSalutationId,
} from "./salutations.js"

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const DATE_FORMAT = (process.env.WEBBEDS_DATE_FORMAT || "YYYY-MM-DD").trim()
const MAX_CHILDREN_PER_ADULT = 2
const MAX_CHILDREN_PER_ROOM = 4

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

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return ["1", "true", "yes", "y"].includes(normalized)
  }
  return false
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

const validateRoomsOccupancy = (rooms = []) => {
  const entries = ensureArray(rooms)
  if (!entries.length) return

  const issues = []
  entries.forEach((room, idx) => {
    const adults = Math.max(0, toNumber(room?.adults) || 0)
    const childrenAges = ensureArray(room?.children || room?.childrenAges || room?.kids)
      .map((age) => toNumber(age))
      .filter((age) => Number.isFinite(age))
    const maxByAdults = adults * MAX_CHILDREN_PER_ADULT
    const maxChildren = Math.min(MAX_CHILDREN_PER_ROOM, maxByAdults)

    if (childrenAges.length > maxChildren) {
      issues.push(`room ${idx + 1}: max ${maxChildren} children for ${adults} adult(s)`)
    }
  })

  if (issues.length) {
    const err = new Error(`Invalid occupancy: ${issues.join("; ")}`)
    err.status = 400
    throw err
  }
}

const buildPassengersDetails = (passengers = []) => {
  const entries = ensureArray(passengers)
  if (!entries.length) return null

  const isLeading = (value) => {
    if (value === true) return true
    if (value === false || value == null) return false
    const normalized = String(value).trim().toLowerCase()
    return ["yes", "y", "true", "1"].includes(normalized)
  }

  // XSD confirmBookingRoomType -> passengersDetails -> passenger (maxOccurs unbounded)
  // passenger -> salutation(int), firstName(str), lastName(str), leading(attr, opt)
  return {
    passenger: entries.map((p) => ({
      salutation: getSalutation(p),
      firstName: p.firstName || p.givenName || "Guest",
      lastName: p.lastName || p.surname || "Name",
      "@leading": isLeading(p.leading) ? "yes" : "no"
    }))
  }
}

const buildRoomsNode = ({
  rooms = [],
  rateBasis,
  nationality,
  residence,
  passengers = [],
}) => {
  const roomEntries = ensureArray(rooms)
  if (!roomEntries.length) {
    throw new Error("WebBeds savebooking requires at least one room")
  }
  validateRoomsOccupancy(roomEntries)

  // Distribuye pasajeros globales entre rooms cuando no vienen por-room.
  const globalPassengers = ensureArray(passengers)
  let passengerCursor = 0
  const assignPassengersForRoom = (roomIdx, room) => {
    if (Array.isArray(room.passengers) && room.passengers.length) {
      return room.passengers
    }
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
    )
      .map((age) => toNumber(age))
      .filter((age) => Number.isFinite(age))
    const neededTotal = neededAdults + actualChildrenAges.length
    const slice = globalPassengers.slice(passengerCursor, passengerCursor + neededTotal)
    passengerCursor += neededTotal
    // Si no hay suficientes, rellena con placeholders
    const placeholders = Array.from({ length: Math.max(0, neededTotal - slice.length) }).map((_, i) => ({
      firstName: "Guest",
      lastName: `R${roomIdx + 1}P${i + 1}`,
      leading: false,
    }))
    return [...slice, ...placeholders]
  }

  // Marca al menos un leading="yes" por habitación (requerido por XSD)
  const roomsPassengers = roomEntries.map((room, idx) => {
    const rp = assignPassengersForRoom(idx, room)
    const hasLeading = rp.some(
      (pax) => String(pax.leading).toLowerCase() === "yes" || pax.leading === true,
    )
    if (!hasLeading && rp.length) {
      rp[0] = { ...rp[0], leading: "yes" }
    }
    // Normaliza el resto a "no" si no viene especificado
    return rp.map((pax, paxIdx) => {
      if (paxIdx === 0 && String(pax.leading).toLowerCase() === "yes") return pax
      if (pax.leading === undefined) return { ...pax, leading: "no" }
      return pax
    })
  })

  return {
    "@no": String(roomEntries.length),
    room: roomEntries.map((room, idx) => {
      const children = ensureArray(room.children || room.childrenAges || room.kids).map((age) =>
        age == null ? null : String(age),
      ).filter((age) => age !== null && age !== undefined && age !== "")

      const actualChildrenAges = ensureArray(
        room.actualChildren ||
        room.actualChildrenAges ||
        room.actualKids ||
        room.actualChildrenAge ||
        room.actualChildrenAges,
      ).map((age) => (age == null ? null : String(age)))
        .filter((age) => age !== null && age !== undefined && age !== "")

      const actualChildrenResolved = actualChildrenAges.length ? actualChildrenAges : children

      const childrenNode = {
        "@no": String(children.length),
      }
      if (children.length) {
        childrenNode["#raw"] = children.map(
          (age, childIdx) => `<child runno="${childIdx}">${String(age)}</child>`,
        ).join("")
      }
      const actualChildrenNode = {
        "@no": String(actualChildrenResolved.length),
      }
      if (actualChildrenResolved.length) {
        actualChildrenNode["#raw"] = actualChildrenResolved.map(
          (age, childIdx) => `<actualChild runno="${childIdx}">${String(age)}</actualChild>`,
        ).join("")
      }

      const paxNode = buildPassengersDetails(roomsPassengers[idx])

      const node = {
        "@runno": String(idx),
        roomTypeCode: room.roomTypeCode || "0", // Mandatory
        selectedRateBasis: room.selectedRateBasis || "0", // Mandatory
        allocationDetails: room.allocationDetails || "", // Mandatory

        adultsCode: String(Math.max(1, toNumber(room.adults) || 1)),
        actualAdults: String(Math.max(1, toNumber(room.actualAdults) || toNumber(room.adults) || 1)), // Mandatory in confirmRoomOccupancy

        children: childrenNode,
        actualChildren: actualChildrenNode, // Mandatory in confirmRoomOccupancy

        // extraBed requerido por XSD: siempre enviamos (default 0)
        extraBed: String(room.extraBed != null ? room.extraBed : 0),

        passengerNationality: room.nationality || nationality || null,
        passengerCountryOfResidence: room.residence || residence || null,

        // Pass rateBasis (the integer code)? It's not in confirmBookingRoomType explicitly 
        // as 'rateBasis'. But roomType has 'rateBasis'. 
        // confirmBookingRoomType DOES NOT extend roomType in XSD. It redefines fields.
        // It does NOT have 'rateBasis' element. It has 'selectedRateBasis'.

        passengersDetails: paxNode,

        // Campos marcados como requeridos en la doc (orden XSD: passengersDetails -> specialRequests -> beddingPreference)
        specialRequests: room.specialRequests
          ? {
            "@count": String(room.specialRequests.length),
            req: room.specialRequests.map((reqCode, reqIdx) => ({
              "@runno": String(reqIdx),
              "#text": String(reqCode),
            })),
          }
          : {
            "@count": "0",
          },
        beddingPreference: room.beddingPreference != null ? String(room.beddingPreference) : "0",
      }

      return node
    }),
  }
}

export const buildSaveBookingPayload = ({
  checkIn,
  checkOut,
  currency = "520",
  hotelId,
  rateBasis = "1",
  nationality,
  residence,
  rooms,
  contact = {},
  passengers = [],
  customerReference,
} = {}) => {
  const fromDate = formatDateValue(checkIn)
  const toDate = formatDateValue(checkOut)
  if (!fromDate || !toDate) {
    throw new Error("WebBeds savebooking requires valid checkIn and checkOut dates")
  }
  const productId = hotelId != null ? String(hotelId).trim() : null
  if (!productId || !/^\d+$/.test(productId)) {
    throw new Error("WebBeds savebooking requires hotelId/productId (numeric)")
  }

  // Booker email
  // const sendCommunicationTo = contact.email || null

  const customerReferenceValue =
    customerReference == null ? null : String(customerReference).trim()

  const roomsNode = buildRoomsNode({
    rooms,
    rateBasis,
    nationality,
    residence,
    passengers,
  })

  // Structure: fromDate, toDate, currency, productId, customerReference, rooms (order matters for XSD)
  const bookingDetails = {
    fromDate,
    toDate,
    currency: currency || "520",
    productId,
    ...(customerReferenceValue ? { customerReference: customerReferenceValue } : {}),
    rooms: roomsNode,
  }

  // Clean undefined
  Object.keys(bookingDetails).forEach(key => bookingDetails[key] === undefined && delete bookingDetails[key])

  return {
    bookingDetails
  }
}

export const mapSaveBookingResponse = (result) => {
  const returnedServiceCodes = ensureArray(result?.returnedServiceCodes?.returnedServiceCode)
  return {
    returnedCode: result?.returnedCode ?? null,
    services: returnedServiceCodes.map((item) => ({
      code: item?.["@_runno"] != null ? String(item["@_runno"]) : null,
      returnedServiceCode:
        typeof item === "string" || typeof item === "number"
          ? String(item)
          : item?.["#text"] ?? item?.["#"] ?? item?.returnedServiceCode ?? null,
    })),
    successful: normalizeBoolean(result?.successful) ?? null,
    bookingId: result?.bookingId ?? null, // Often returned in success
    metadata: {
      command: result?.["@_command"] ?? null,
      date: result?.["@_date"] ?? null,
      ip: result?.["@_ip"] ?? null,
    },
  }
}
