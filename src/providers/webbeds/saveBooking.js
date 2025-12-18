import dayjs from "dayjs"

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const DATE_FORMAT = (process.env.WEBBEDS_DATE_FORMAT || "YYYY-MM-DD").trim()

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
  // Map strings to integers if necessary.
  // Assumption: 1=Mr, 2=Mrs, 3=Ms. Default to 1 (Mr) if unknown.
  if (typeof p.salutation === "number") return p.salutation
  if (typeof p.title === "number") return p.title

  const t = (p.title || p.salutation || "").toLowerCase()
  if (t.includes("mrs")) return 2
  if (t.includes("miss") || t.includes("ms")) return 3
  return 1 // Default Mr
}

const buildPassengersDetails = (passengers = []) => {
  const entries = ensureArray(passengers)
  if (!entries.length) return null

  // XSD confirmBookingRoomType -> passengersDetails -> passenger (maxOccurs unbounded)
  // passenger -> salutation(int), firstName(str), lastName(str), leading(attr, opt)
  return {
    passenger: entries.map((p) => ({
      salutation: getSalutation(p),
      firstName: p.firstName || p.givenName || "Guest",
      lastName: p.lastName || p.surname || "Name",
      "@leading": p.leading ? "yes" : "no"
    }))
  }
}

const buildRoomsNode = ({
  rooms = [],
  rateBasis,
  nationality,
  residence,
  passengers = [],
  customerReference,
}) => {
  const roomEntries = ensureArray(rooms)
  if (!roomEntries.length) {
    throw new Error("WebBeds savebooking requires at least one room")
  }

  // Distribuye pasajeros globales entre rooms cuando no vienen por-room.
  const globalPassengers = ensureArray(passengers)
  let passengerCursor = 0
  const assignPassengersForRoom = (roomIdx, room) => {
    if (Array.isArray(room.passengers) && room.passengers.length) {
      return room.passengers
    }
    const neededAdults = Math.max(1, toNumber(room.adults) || 1)
    const slice = globalPassengers.slice(passengerCursor, passengerCursor + neededAdults)
    passengerCursor += neededAdults
    // Si no hay suficientes, rellena con placeholders
    const placeholders = Array.from({ length: Math.max(0, neededAdults - slice.length) }).map((_, i) => ({
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

      const childrenNode = {
        "@no": String(children.length),
      }
      if (children.length) {
        childrenNode["#raw"] = children.map(
          (age, childIdx) => `<child runno="${childIdx}">${String(age)}</child>`,
        ).join("")
      }
      const actualChildrenNode = {
        "@no": String(children.length),
      }
      if (children.length) {
        actualChildrenNode["#raw"] = children.map(
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
        actualAdults: String(Math.max(1, toNumber(room.adults) || 1)), // Mandatory in confirmRoomOccupancy

        children: childrenNode,
        actualChildren: actualChildrenNode, // Mandatory in confirmRoomOccupancy

        // extraBed requerido por XSD: siempre enviamos (default 0)
        extraBed: String(room.extraBed != null ? room.extraBed : 0),

        passengerNationality: room.nationality || nationality || null,
        passengerCountryOfResidence: room.residence || residence || null,

        customerReference: customerReference || null,

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

  const roomsNode = buildRoomsNode({
    rooms,
    rateBasis,
    nationality,
    residence,
    passengers,
    customerReference
  })

  // Structure: fromDate, toDate, currency, productId, sendCommunicationTo, customerReference, rooms
  const bookingDetails = {
    fromDate,
    toDate,
    currency: currency || "520",
    productId,
    customerReference,
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
