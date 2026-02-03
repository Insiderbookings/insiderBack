import dayjs from "dayjs"

const DATE_FORMAT = (process.env.WEBBEDS_DATE_FORMAT || "YYYY-MM-DD").trim()

const formatDateWebbeds = (value) => {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null

  const normalized = DATE_FORMAT.toLowerCase()
  if (["unix", "epoch", "seconds", "x"].includes(normalized)) {
    return Math.floor(parsed.valueOf() / 1000).toString()
  }

  return parsed.format(DATE_FORMAT)
}
const MAX_ADULTS = 10
const DEFAULT_RATE_BASIS = "-1"
const DEFAULT_CURRENCY = "520"
const DEFAULT_CHILD_AGE = 8
const MAX_CHILDREN_PER_ADULT = 2
const MAX_CHILDREN_PER_ROOM = 4

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "yes" || normalized === "1"
  }
  return false
}

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const ensureArray = (value) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const requireNumericCode = (value) => {
  if (value === undefined || value === null || value === "") return null
  const strValue = String(value).trim()
  return /^\d+$/.test(strValue) ? strValue : null
}

const formatDate = (value) => {
  if (!value) return null
  return formatDateWebbeds(value)
}

const parseChildrenSegment = (segment) => {
  if (!segment || segment === "0") return []
  if (segment.includes("-")) {
    return segment
      .split("-")
      .map((age) => String(age).trim())
      .filter((age) => age !== "")
      .map((age) => toNumber(age))
      .filter((age) => Number.isFinite(age))
  }
  const count = toNumber(segment)
  if (!Number.isFinite(count) || count <= 0) return []
  return Array.from({ length: count }, () => DEFAULT_CHILD_AGE)
}

const parseOccupancies = (raw) => {
  if (!raw) return [{ adults: 2, children: [] }]
  const serialized = Array.isArray(raw) ? raw : String(raw).split(",")
  return serialized
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [adultsStr = "2", childrenStr = "0"] = token.split("|")
      const adults = Math.min(Math.max(toNumber(adultsStr) ?? 2, 1), MAX_ADULTS)
      const children = parseChildrenSegment(childrenStr)
      return { adults, children }
    })
}

const validateOccupancies = (rooms = []) => {
  const entries = ensureArray(rooms)
  if (!entries.length) return

  const issues = []
  entries.forEach((room, idx) => {
    const adults = Number(room?.adults ?? 0) || 0
    const children = ensureArray(room?.children)
    const maxByAdults = Math.max(0, adults) * MAX_CHILDREN_PER_ADULT
    const maxChildren = Math.min(MAX_CHILDREN_PER_ROOM, maxByAdults)

    if (children.length > maxChildren) {
      issues.push(`room ${idx + 1}: max ${maxChildren} children for ${adults} adult(s)`)
    }
  })

  if (issues.length) {
    const err = new Error(`Invalid occupancy: ${issues.join("; ")}`)
    err.status = 400
    throw err
  }
}

const buildRoomNode = ({
  adults,
  children,
  runno,
  rateBasis,
  nationality,
  residence,
}) => {
  const childrenCount = children.length
  const node = {
    "@runno": String(runno),
    adultsCode: String(Math.max(1, Math.min(MAX_ADULTS, adults))),
    children: {
      "@no": String(childrenCount),
    },
    rateBasis: rateBasis ?? DEFAULT_RATE_BASIS,
    passengerNationality: nationality,
    passengerCountryOfResidence: residence,
  }

  if (childrenCount > 0) {
    node.children.child = children.map((age, idx) => ({
      "@runno": String(idx),
      "#text": String(age ?? DEFAULT_CHILD_AGE),
    }))
  }

  return node
}

const NAMESPACE_ATOMIC = "http://us.dotwconnect.com/xsd/atomicCondition"
const NAMESPACE_COMPLEX = "http://us.dotwconnect.com/xsd/complexCondition"

const buildFilters = ({ cityCode, countryCode, filterConditions }) => {
  // XSD: filtersType is a sequence of cityOrCountryFilter (optional), noPrice, rateTypes, c:condition.
  // When only city/country is used, do NOT add xmlns on <filters> or DOTW returns "XML request NOT XSD VALID" (code 26).
  // Add xmlns only when we have c:condition (advanced conditions).
  const filters = {}
  if (filterConditions && filterConditions.length) {
    filters["@xmlns:a"] = NAMESPACE_ATOMIC
    filters["@xmlns:c"] = NAMESPACE_COMPLEX
    filters["c:condition"] = filterConditions
  } else {
    if (cityCode) filters.city = cityCode
    if (!cityCode && countryCode) filters.country = countryCode
  }
  return filters
}

const normalizeOperator = (value) => {
  if (!value) return null
  const upper = String(value).trim().toUpperCase()
  if (upper === "AND" || upper === "OR") return upper
  return null
}

const buildAdvancedConditions = (conditions = [], operator) => {
  if (!conditions.length) return null
  const formatted = conditions
    .map((condition) => {
      const fieldName = condition?.fieldName
      const fieldTest = condition?.fieldTest
      const values = ensureArray(condition?.fieldValues).filter(Boolean)
      if (!fieldName || !fieldTest || !values.length) return null
      return {
        "fieldName": fieldName,
        "fieldTest": fieldTest,
        fieldValues: {
          fieldValue: values,
        },
      }
  })
    .filter(Boolean)

  if (!formatted.length) return null

  const normalizedOperator = normalizeOperator(operator) || "AND"

  if (formatted.length === 1) {
    return {
      "@xmlns:a": NAMESPACE_ATOMIC,
      "@xmlns:c": NAMESPACE_COMPLEX,
      "c:condition": {
        "a:condition": formatted[0],
      },
    }
  }

  // Para múltiples condiciones, generamos el XML manualmente para respetar el XSD:
  // <c:condition><a:condition/> <operator/> <a:condition/> ...</c:condition>
  const serializeCondition = (item) => {
    const values = Array.isArray(item.fieldValues?.fieldValue)
      ? item.fieldValues.fieldValue
      : [item.fieldValues?.fieldValue ?? item.fieldValues].filter(Boolean)
    const valuesXml = values.map((val) => `<fieldValue>${val}</fieldValue>`).join("")
    return `<a:condition><fieldName>${item.fieldName}</fieldName><fieldTest>${item.fieldTest}</fieldTest><fieldValues>${valuesXml}</fieldValues></a:condition>`
  }

  const raw = formatted
    .map((item, idx) => {
      const part = serializeCondition(item)
      if (idx === formatted.length - 1) return part
      return `${part}<operator>${normalizedOperator}</operator>`
    })
    .join("")

  return {
    "@xmlns:a": NAMESPACE_ATOMIC,
    "@xmlns:c": NAMESPACE_COMPLEX,
    "c:condition": {
      "#raw": raw,
    },
  }
}

export const buildSearchHotelsPayload = ({
  checkIn,
  checkOut,
  currency = DEFAULT_CURRENCY,
  occupancies,
  nationality,
  residence,
  rateBasis,
  cityCode,
  countryCode,
  filterConditions,
  advancedConditions,
  advancedOperator,
  includeNoPrice = false,
  resultsPerPage,
  page,
  rateTypes,
  productCodeRequested,
  debug,
} = {}) => {
  const fromDate = formatDate(checkIn)
  const toDate = formatDate(checkOut)

  if (!fromDate || !toDate) {
    throw new Error("WebBeds search requires valid checkIn and checkOut dates")
  }

  const resolvedNationality = requireNumericCode(nationality)
  const resolvedResidence = requireNumericCode(residence)
  if (!resolvedNationality || !resolvedResidence) {
    throw new Error("WebBeds search requires passengerNationality and passengerCountryOfResidence")
  }
  const parsedRooms = parseOccupancies(occupancies)
  validateOccupancies(parsedRooms)
  const rooms = parsedRooms.map((room, idx) =>
    buildRoomNode({
      ...room,
      runno: idx,
      rateBasis,
      nationality: resolvedNationality,
      residence: resolvedResidence,
    }),
  )

  const filters = buildFilters({ cityCode, countryCode, filterConditions })
  if (includeNoPrice) {
    filters.noPrice = "true"
  }

  if (rateTypes && rateTypes.length) {
    filters.rateTypes = {
      rateType: rateTypes
    }
  }

  const advanced = buildAdvancedConditions(advancedConditions, advancedOperator)
  if (advanced) {
    filters["@xmlns:a"] = advanced["@xmlns:a"]
    filters["@xmlns:c"] = advanced["@xmlns:c"]
    filters["c:condition"] = advanced["c:condition"]
  }

  const returnNode = {
    filters,
  }

  if (resultsPerPage || page) {
    returnNode.resultsPerPage = String(resultsPerPage || "20")
    returnNode.page = String(page || "1")
  }

  const bookingDetails = {
    fromDate,
    toDate,
    currency: currency || DEFAULT_CURRENCY,
    productCodeRequested: productCodeRequested ? String(productCodeRequested) : undefined,
    rooms: {
      "@no": String(rooms.length),
      room: rooms,
    },
  }
  // Remove undefined keys in bookingDetails if any (productCodeRequested)
  Object.keys(bookingDetails).forEach(key => bookingDetails[key] === undefined && delete bookingDetails[key])

  const payload = {
    bookingDetails,
    return: returnNode,
  }

  const requestAttributes = {}
  if (debug) {
    requestAttributes.debug = debug
  }

  return { payload, requestAttributes }
}

const parseCancellationRules = (rateBasis) => {
  const rules = ensureArray(rateBasis?.cancellationRules?.rule)
  return rules.map((rule) => ({
    fromDate: rule?.fromDate ?? null,
    toDate: rule?.toDate ?? null,
    amendRestricted: normalizeBoolean(rule?.amendRestricted),
    cancelRestricted: normalizeBoolean(rule?.cancelRestricted),
    noShowPolicy: normalizeBoolean(rule?.noShowPolicy),
    amendCharge: toNumber(rule?.amendCharge),
    cancelCharge: toNumber(rule?.cancelCharge ?? rule?.charge),
    currency: rateBasis?.rateType?.["@_currencyid"] ?? null,
  }))
}

const parsePropertyFees = (rateBasis) => {
  const fees = ensureArray(rateBasis?.propertyFees?.propertyFee)
  return fees.map((fee) => ({
    name: fee?.["@_name"] ?? null,
    description: fee?.["@_description"] ?? null,
    includedInPrice: normalizeBoolean(fee?.["@_includedinprice"]),
    amount: toNumber(fee?.["#"] ?? fee?.["#text"] ?? fee?.text),
    currency: fee?.["@_currencyshort"] ?? null,
    type: fee?.["@_description"] ?? null,
  }))
}

const resolveMinStayValue = (...candidates) => {
  for (const candidate of candidates) {
    const value = toNumber(candidate)
    if (value != null) {
      return value
    }
  }
  return null
}

const resolveMinStayDate = (...candidates) => {
  for (const candidate of candidates) {
    if (candidate != null && candidate !== "") {
      return String(candidate)
    }
  }
  return null
}

const extractPrice = (rateBasis) => {
  if (rateBasis?.totalInRequestedCurrency) {
    const value = rateBasis.totalInRequestedCurrency
    if (typeof value === "string") {
      const parsed = toNumber(value)
      if (parsed !== null) return parsed
    } else if (typeof value === "object") {
      const numeric = toNumber(value["#"] ?? value.value ?? value.amount)
      if (numeric !== null) return numeric
    }
  }
  return toNumber(rateBasis?.total) ?? toNumber(rateBasis?.totalNetPrice)
}

const getText = (value) => {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof value === "object") {
    return value["#"] ?? value["#text"] ?? value.text ?? value.__cdata ?? value.cdata ?? null
  }
  return null
}

const parseSimpleItems = (node, key) => {
  const languages = ensureArray(node?.language ?? node)
  const items = []
  languages.forEach((lang) => {
    const values = ensureArray(lang?.[key])
    values.forEach((val) => {
      const label = getText(val)
      if (label) {
        items.push({
          id: val?.["@_id"] ?? val?.["@id"] ?? null,
          label,
          language: lang?.["@_id"] ?? lang?.["@id"] ?? lang?.id ?? null,
        })
      }
    })
  })
  return items
}

const parseHotelImages = (images) => {
  const allImages = []
  const hotelImages = images?.hotelImages
  const thumb = getText(hotelImages?.thumb)
  if (thumb) {
    allImages.push({
      url: thumb,
      alt: "thumbnail",
      categoryId: null,
      categoryName: "thumbnail",
    })
  }
  const entries = ensureArray(hotelImages?.image)
  entries.forEach((img) => {
    const url = getText(img?.url ?? img)
    if (!url) return
    allImages.push({
      url,
      alt: img?.alt ?? null,
      categoryId: img?.category?.["@_id"] ?? img?.category?.["@id"] ?? null,
      categoryName: getText(img?.category) ?? null,
    })
  })
  return allImages
}

const parseDescriptions = (hotel) => {
  return ["description1", "description2"]
    .map((key) => {
      const node = hotel?.[key]
      const languages = ensureArray(node?.language ?? node)
      return languages
        .map((lang) => {
          const text = getText(lang)
          if (!text) return null
          return {
            key,
            language: lang?.["@_id"] ?? lang?.["@id"] ?? lang?.id ?? null,
            text,
          }
        })
        .filter(Boolean)
    })
    .flat()
}

const parseGeoPoint = (geoPoint) => {
  if (!geoPoint) return null
  return {
    lat: toNumber(geoPoint?.lat),
    lng: toNumber(geoPoint?.lng),
  }
}

const parseGeoLocations = (geoLocations) => {
  const locations = ensureArray(geoLocations?.geoLocation)
  return locations.map((item) => ({
    id: item?.["@_id"] ?? item?.["@id"] ?? item?.id ?? null,
    name: item?.name ?? null,
    type: item?.type ?? null,
    distance: toNumber(item?.distance),
  }))
}

export const mapSearchHotelsResponse = (result) => {
  const hotels = ensureArray(result?.hotels?.hotel)
  if (!hotels.length) return []

  const fallbackCurrency = result?.currencyShort ?? null
  const options = []

  hotels.forEach((hotel) => {
    const hotelId = hotel?.["@_hotelid"] ?? hotel?.hotelid ?? null
    const hotelName = hotel?.name ?? hotel?.hotelName ?? null

    const hotelDetails = {
      hotelCode: hotelId,
      hotelName,
      city: hotel?.cityName ?? null,
      cityCode: hotel?.cityCode ?? null,
      country: hotel?.countryName ?? null,
      countryCode: hotel?.countryCode ?? null,
      state: hotel?.stateName ?? null,
      region: {
        name: hotel?.regionName ?? null,
        code: hotel?.regionCode ?? null,
      },
      address: hotel?.address ?? hotel?.fullAddress?.hotelStreetAddress ?? null,
      zipCode: hotel?.zipCode ?? hotel?.fullAddress?.hotelZipCode ?? null,
      locations: [hotel?.location1, hotel?.location2, hotel?.location3].filter(Boolean),
      geoPoint: parseGeoPoint(hotel?.geoPoint),
      geoLocations: parseGeoLocations(hotel?.geoLocations),
      rating: hotel?.rating ?? null,
      phone: hotel?.hotelPhone ?? null,
      checkIn: hotel?.hotelCheckIn ?? null,
      checkOut: hotel?.hotelCheckOut ?? null,
      minAge: toNumber(hotel?.minAge),
      builtYear: hotel?.builtYear ?? null,
      renovationYear: hotel?.renovationYear ?? null,
      amenities: parseSimpleItems(hotel?.amenitie, "amenitieItem"),
      leisure: parseSimpleItems(hotel?.leisure, "leisureItem"),
      business: parseSimpleItems(hotel?.business, "businessItem"),
      descriptions: parseDescriptions(hotel),
      images: parseHotelImages(hotel?.images),
      chain: hotel?.chain ?? null,
      priority: hotel?.priority ?? null,
      preferred: normalizeBoolean(hotel?.preferred),
      exclusive: normalizeBoolean(hotel?.exclusive),
      fireSafety: normalizeBoolean(hotel?.fireSafety),
    }

    const rooms = ensureArray(hotel?.rooms?.room)

    rooms.forEach((room) => {
      const roomTypes = ensureArray(room?.roomType)
      roomTypes.forEach((roomType) => {
        const roomTypeCode = roomType?.["@_roomtypecode"] ?? null
        const roomTypeName = roomType?.name ?? null
        const rateBases = ensureArray(roomType?.rateBases?.rateBasis)

        if (!rateBases.length) {
          options.push({
            rateKey: [hotelId, roomTypeCode].filter(Boolean).join("|"),
            hotelCode: hotelId,
            hotelName,
            board: null,
            paymentType: null,
            status: "INFO_ONLY",
            price: null,
            currency: fallbackCurrency,
            refundable: null,
            rooms: [],
            cancelPolicy: null,
            surcharges: [],
            metadata: { rateBasisId: null, infoOnly: true },
            hotelDetails,
          })
          return
        }

        rateBases.forEach((rateBasis) => {
          const rateBasisId = rateBasis?.["@_id"] ?? null
          const rateType = rateBasis?.rateType ?? {}
          const nonRefundable = normalizeBoolean(rateType?.["@_nonrefundable"])
          const price = extractPrice(rateBasis)
          const minStay = resolveMinStayValue(
            rateBasis?.minStay,
            rateType?.["@_minstay"],
            roomType?.minStay,
            room?.minStay,
            hotel?.minStay,
          )
          const dateApplyMinStay = resolveMinStayDate(
            rateBasis?.dateApplyMinStay,
            rateBasis?.applyMinStay,
            roomType?.dateApplyMinStay,
          )

          const currency = rateType?.["@_currencyid"] ?? fallbackCurrency

          const option = {
            rateKey: [hotelId, roomTypeCode, rateBasisId].filter(Boolean).join("|"),
            hotelCode: hotelId,
            hotelName,
            board: rateType?.["@_notes"] ?? null,
            paymentType: "MERCHANT",
            status: "AVAILABLE",
            price,
            currency,
            refundable: !nonRefundable,
            rooms: [
              {
                code: roomTypeCode,
                description: roomTypeName,
                refundable: !nonRefundable,
                price,
                currency,
                rateBasisId,
                minStay,
                dateApplyMinStay,
              },
            ],
            cancelPolicy: {
              refundable: !nonRefundable,
              penalties: parseCancellationRules(rateBasis),
            },
            surcharges: parsePropertyFees(rateBasis),
            metadata: {
              rateBasisId,
              rateType: rateType?.["@_id"] ?? null,
              totalTaxes: toNumber(rateBasis?.totalTaxes),
              totalFees: toNumber(rateBasis?.totalFee),
              propertyFeesCount: rateBasis?.propertyFees?.["@_count"] ?? null,
              minStay,
              dateApplyMinStay,
            },
            hotelDetails,
          }

          options.push(option)
        })
      })
    })
  })

  return options
}
