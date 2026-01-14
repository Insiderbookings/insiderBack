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

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value && typeof value === "object") {
    const raw = value["#"] ?? value.value ?? value.amount ?? value._ ?? null
    if (raw != null) return toNumber(String(raw))
  }
  return null
}

const getText = (value) => {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object") {
    return value["#"] ?? value["#text"] ?? value.text ?? value.__cdata ?? value.cdata ?? null
  }
  return null
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
  return Array.from({ length: count }, () => 8)
}

const MAX_CHILDREN_PER_ADULT = 2
const MAX_CHILDREN_PER_ROOM = 4

const parseList = (value) => {
  if (!value) return []
  if (Array.isArray(value)) return value
  const text = String(value).trim()
  if (!text) return []
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // ignore JSON parse errors and fallback to comma split
    }
  }
  return text.split(",").map((token) => token.trim()).filter(Boolean)
}

const parseOccupancies = (raw) => {
  if (!raw) return [{ adults: 2, children: [] }]
  const serialized = Array.isArray(raw) ? raw : String(raw).split(",")
  return serialized
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [adultsStr = "2", childrenStr = "0"] = token.split("|")
      const adults = Math.min(Math.max(toNumber(adultsStr) ?? 2, 1), 10)
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

export const buildGetRoomsPayload = ({
  checkIn,
  checkOut,
  currency = "520",
  occupancies,
  rateBasis = "1",
  nationality,
  residence,
  hotelId,
  roomTypeCode,
  selectedRateBasis,
  allocationDetails,
  req = null,
} = {}) => {
  const fromDate = formatDateValue(checkIn)
  const toDate = formatDateValue(checkOut)

  if (!fromDate || !toDate) {
    throw new Error("WebBeds getrooms requires valid checkIn and checkOut dates")
  }
  const hotelCode = hotelId != null ? String(hotelId).trim() : null
  if (!hotelCode || !/^\d+$/.test(hotelCode)) {
    throw new Error("WebBeds getrooms requires hotelId (productId)")
  }

  const parsedRooms = parseOccupancies(occupancies)
  validateOccupancies(parsedRooms)

  const sanitizeRoomTypeSelection = ({
    roomTypeCode,
    selectedRateBasis,
    allocationDetails,
  } = {}) => {
    const code = roomTypeCode != null ? String(roomTypeCode).trim() : null
    const rateBasisSel = selectedRateBasis != null ? String(selectedRateBasis).trim() : null
    const alloc = allocationDetails != null ? String(allocationDetails).trim() : null

    // Debe tener al menos code y allocation; selectedRateBasis opcional pero útil.
    if (!code || !alloc) return null
    // Evita enviar placeholders tipo "<ROOMTYPE_CODE>"
    if (code.includes("<") || alloc.includes("<") || (rateBasisSel && rateBasisSel.includes("<"))) {
      return null
    }

    const node = {
      code,
    }
    if (rateBasisSel) {
      // Orden segun XSD: code -> selectedRateBasis -> allocationDetails
      node.selectedRateBasis = rateBasisSel
    }
    node.allocationDetails = alloc
    return node
  }

  const roomTypeSelectedNode = sanitizeRoomTypeSelection({
    roomTypeCode,
    selectedRateBasis,
    allocationDetails,
  })

  // Permitir selection por habitaciǬn: roomSelections (JSON) o listas CSV roomTypeCodes/selectedRateBases/allocationDetailsList
  const selectionPerRoom = []

  const rawRoomSelections = req?.query?.roomSelections ?? req?.body?.roomSelections
  if (rawRoomSelections) {
    try {
      const parsed = typeof rawRoomSelections === "string" ? JSON.parse(rawRoomSelections) : rawRoomSelections
      if (Array.isArray(parsed)) {
        parsed.forEach((sel) => {
          const node = sanitizeRoomTypeSelection({
            roomTypeCode: sel?.code ?? sel?.roomTypeCode,
            selectedRateBasis: sel?.selectedRateBasis ?? sel?.rateBasis ?? sel?.rateBasisId,
            allocationDetails: sel?.allocationDetails ?? sel?.allocation ?? sel?.alloc,
          })
          if (node) selectionPerRoom.push(node)
        })
      }
    } catch (error) {
      console.warn("[webbeds] getRooms roomSelections parse error:", error.message)
    }
  }

  if (!selectionPerRoom.length) {
    const codes = parseList(
      req?.query?.roomTypeCodes ?? req?.body?.roomTypeCodes ?? req?.query?.roomTypeCode ?? req?.body?.roomTypeCode,
    )
    const bases = parseList(
      req?.query?.selectedRateBases ?? req?.body?.selectedRateBases ?? req?.query?.selectedRateBasis ?? req?.body?.selectedRateBasis,
    )
    const allocs = parseList(
      req?.query?.allocationDetailsList ?? req?.body?.allocationDetailsList ?? req?.query?.allocationDetails ?? req?.body?.allocationDetails,
    )
    const maxLen = Math.max(codes.length, bases.length, allocs.length)
    for (let idx = 0; idx < maxLen; idx += 1) {
      const node = sanitizeRoomTypeSelection({
        roomTypeCode: codes[idx] ?? codes[0],
        selectedRateBasis: bases[idx] ?? bases[0],
        allocationDetails: allocs[idx] ?? allocs[0],
      })
      if (node) selectionPerRoom.push(node)
    }
  }

  const rooms = parsedRooms.map((room, idx) => {
    const childrenCount = room.children.length
    const childrenNode = {
      "@no": String(childrenCount),
    }
    if (childrenCount) {
      childrenNode["#raw"] = room.children
        .map(
          (age, childIdx) =>
            `<child runno="${childIdx}">${String(age ?? 8)}</child>`,
        )
        .join("")
    }

    const roomNode = {
      "@runno": String(idx),
      adultsCode: String(room.adults),
      children: childrenNode,
      rateBasis: rateBasis ?? "1",
      passengerNationality: nationality,
      passengerCountryOfResidence: residence,
    }

    const selection = selectionPerRoom[idx] ?? roomTypeSelectedNode
    if (selection) {
      roomNode.roomTypeSelected = selection
    }

    return roomNode
  })

  return {
    bookingDetails: {
      fromDate,
      toDate,
      currency: currency || "520",
      rooms: {
        "@no": String(rooms.length),
        room: rooms,
      },
      productId: hotelCode,
    },
  }
}

const parseCancellationRules = (node) => {
  const rules = ensureArray(node?.rule ?? node)
  return rules.map((rule) => ({
    runno: rule?.["@_runno"] ?? null,
    fromDate: rule?.fromDate ?? null,
    fromDateDetails: rule?.fromDateDetails ?? null,
    toDate: rule?.toDate ?? null,
    toDateDetails: rule?.toDateDetails ?? null,
    amendRestricted: normalizeBoolean(rule?.amendRestricted),
    cancelRestricted: normalizeBoolean(rule?.cancelRestricted),
    noShowPolicy: normalizeBoolean(rule?.noShowPolicy),
    amendCharge: toNumber(rule?.amendCharge),
    cancelCharge: toNumber(rule?.cancelCharge ?? rule?.charge),
    currency: rule?.rateType?.["@_currencyid"] ?? null,
    formatted: getText(rule?.charge?.formatted ?? rule?.cancelCharge?.formatted),
  }))
}

const parsePropertyFees = (rateBasis) => {
  const fees = ensureArray(rateBasis?.propertyFees?.propertyFee)
  return fees.map((fee) => ({
    runno: fee?.["@_runno"] ?? null,
    name: fee?.["@_name"] ?? null,
    description: fee?.["@_description"] ?? null,
    includedInPrice: normalizeBoolean(fee?.["@_includedinprice"]),
    amount: toNumber(fee?.["#"]),
    currency: fee?.["@_currencyshort"] ?? null,
  }))
}

const parseSpecials = (node) => {
  if (!node) return []
  const raw = node?.special ?? node?.specialItem ?? node?.item ?? node
  return ensureArray(raw)
    .map((entry) => {
      if (!entry) return null
      if (typeof entry === "string" || typeof entry === "number") return String(entry)
      return (
        getText(entry?.description ?? entry?.["@_description"] ?? entry?.name ?? entry) ??
        null
      )
    })
    .filter(Boolean)
}

const parseIncludedMeals = (includingNode) => {
  if (!includingNode) return []
  const raw = includingNode?.includedMeal ?? includingNode?.meal ?? includingNode
  return ensureArray(raw)
    .map((meal) => {
      if (!meal) return null
      const mealType = meal?.mealType ?? meal?.mealtype ?? null
      const mealName = getText(meal?.mealName ?? meal?.name ?? meal)
      const mealTypeName = getText(mealType)
      const mealTypeCode = mealType?.["@_code"] ?? mealType?.["@_id"] ?? null
      return {
        runno: meal?.["@_runno"] ?? null,
        mealName: mealName ?? null,
        mealTypeName: mealTypeName ?? null,
        mealTypeCode: mealTypeCode != null ? String(mealTypeCode) : null,
      }
    })
    .filter((meal) => meal.mealName || meal.mealTypeName)
}

const parseChildrenAges = (value) => {
  if (!value) return null
  if (Array.isArray(value)) {
    const ages = value.map((age) => toNumber(age)).filter((age) => Number.isFinite(age))
    return ages.length ? ages : null
  }
  const text = getText(value)
  if (!text) return null
  const ages = text
    .split(",")
    .map((token) => toNumber(String(token).trim()))
    .filter((age) => Number.isFinite(age))
  return ages.length ? ages : null
}

const parseValidForOccupancy = (node) => {
  if (!node) return null
  const adults = toNumber(getText(node?.adults ?? node?.adult))
  const children = toNumber(getText(node?.children ?? node?.child))
  const childrenAges = parseChildrenAges(node?.childrenAges ?? node?.childrenAge)
  const infants = toNumber(getText(node?.infants ?? node?.infant))
  const extraBed = toNumber(getText(node?.extraBed ?? node?.extraBeds ?? node?.extrabed))
  const extraBedOccupant = getText(node?.extraBedOccupant ?? node?.extraBedOccupantType)
  const maxOccupancy = toNumber(getText(node?.maxOccupancy ?? node?.maxPax))
  const details = {
    adults,
    children,
    childrenAges,
    infants,
    extraBed,
    extraBedOccupant,
    maxOccupancy,
  }
  const cleaned = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== null && value !== undefined),
  )
  return Object.keys(cleaned).length ? cleaned : null
}

const resolveValidForOccupancyFlag = (node) => {
  if (node == null) return null
  if (typeof node === "boolean") return node
  const text = getText(node)
  if (text != null) return normalizeBoolean(text)
  return null
}

const parseRateBases = (rateBasesNode, requestedCurrency, roomTypeSpecials = []) => {
  const rateBases = ensureArray(rateBasesNode?.rateBasis ?? rateBasesNode)
  return rateBases.map((rateBasis) => {
    const rateType = rateBasis?.rateType ?? {}
    const changedOccupancyValue = getText(rateBasis?.changedOccupancy)
    const changedOccupancyFlag =
      changedOccupancyValue != null ? true : normalizeBoolean(rateBasis?.changedOccupancy)
    const changedOccupancyText = getText(rateBasis?.changedOccupancyText)
    const resolvedTotal =
      toNumber(rateBasis?.totalInRequestedCurrency) ??
      toNumber(rateBasis?.total) ??
      toNumber(rateBasis?.totalNetPrice) ??
      toNumber(rateBasis?.totalMinimumSelling)

    const resolvedTotalFormatted =
      getText(rateBasis?.totalInRequestedCurrencyFormatted) ??
      getText(rateBasis?.totalFormatted) ??
      getText(rateBasis?.total?.formatted) ??
      getText(rateBasis?.totalMinimumSelling?.formatted) ??
      getText(rateBasis?.totalMinimumSellingFormatted)

    const specials = parseSpecials(rateBasis?.specials)
    const mergedSpecials = specials.length ? specials : roomTypeSpecials
    const dateEntries = ensureArray(rateBasis?.dates?.date)
    const includedMealsRaw = dateEntries.flatMap((date) => parseIncludedMeals(date?.including))
    const uniqueMeals = []
    const seenMeals = new Set()
    includedMealsRaw.forEach((meal) => {
      const key = `${meal.mealTypeCode ?? ""}|${meal.mealName ?? ""}|${meal.mealTypeName ?? ""}`
      if (seenMeals.has(key)) return
      seenMeals.add(key)
      uniqueMeals.push(meal)
    })
    const primaryMeal = uniqueMeals[0] ?? null

    return {
      id: rateBasis?.["@_id"] ?? null,
      description: rateBasis?.["@_description"] ?? rateBasis?.description ?? null,
      status: rateBasis?.status ?? rateBasis?.["@_status"] ?? null,
      rateType: {
        id: rateType?.["@_id"] ?? null,
        description: rateType?.["@_description"] ?? null,
        currencyId: rateType?.["@_currencyid"] ?? requestedCurrency ?? null,
        currencyShort: rateType?.["@_currencyshort"] ?? null,
        nonRefundable: normalizeBoolean(rateType?.["@_nonrefundable"]),
        notes: rateType?.["@_notes"] ?? null,
      },
      paymentMode: rateBasis?.paymentMode ?? null,
      allowsExtraMeals: normalizeBoolean(rateBasis?.allowsExtraMeals),
      allowsSpecialRequests: normalizeBoolean(rateBasis?.allowsSpecialRequests),
      allowsBeddingPreference: normalizeBoolean(rateBasis?.allowsBeddingPreference),
      allocationDetails: getText(rateBasis?.allocationDetails),
      minStay: toNumber(rateBasis?.minStay),
      dateApplyMinStay: rateBasis?.dateApplyMinStay ?? null,
      cancellationRules: parseCancellationRules(rateBasis?.cancellationRules),
      withinCancellationDeadline: normalizeBoolean(rateBasis?.withinCancellationDeadline),
      validForOccupancy: resolveValidForOccupancyFlag(rateBasis?.validForOccupancy),
      validForOccupancyDetails: parseValidForOccupancy(rateBasis?.validForOccupancy),
      changedOccupancy: changedOccupancyFlag,
      changedOccupancyValue,
      changedOccupancyText,
      isBookable: normalizeBoolean(rateBasis?.isBookable),
      onRequest: normalizeBoolean(rateBasis?.onRequest),
      total: resolvedTotal,
      totalFormatted: resolvedTotalFormatted,
      totalMinimumSelling: toNumber(rateBasis?.totalMinimumSelling),
      totalMinimumSellingFormatted:
        getText(rateBasis?.totalMinimumSelling?.formatted ?? rateBasis?.totalMinimumSellingFormatted) ??
        resolvedTotalFormatted,
      totalInRequestedCurrency: toNumber(rateBasis?.totalInRequestedCurrency),
      totalMinimumSellingInRequestedCurrency: toNumber(
        rateBasis?.totalMinimumSellingInRequestedCurrency,
      ),
      minimumSelling: toNumber(
        rateBasis?.minimumSelling ?? rateBasis?.priceMinimumSelling ?? rateBasis?.totalMinimumSelling,
      ),
      minimumSellingFormatted:
        getText(rateBasis?.minimumSelling?.formatted ?? rateBasis?.priceMinimumSelling?.formatted) ??
        getText(rateBasis?.totalMinimumSelling?.formatted ?? rateBasis?.totalMinimumSellingFormatted) ??
        resolvedTotalFormatted,
      totalTaxes: toNumber(rateBasis?.totalTaxes),
      totalFee: toNumber(rateBasis?.totalFee),
      propertyFees: parsePropertyFees(rateBasis),
      specials: mergedSpecials,
      includedMeals: uniqueMeals,
      includedMeal: primaryMeal,
      mealPlan: primaryMeal?.mealName ?? primaryMeal?.mealTypeName ?? null,
      dates: dateEntries.map((date) => ({
        datetime: date?.["@_datetime"] ?? date?.datetime ?? null,
        day: date?.["@_day"] ?? date?.day ?? null,
        wday: date?.["@_wday"] ?? date?.wday ?? null,
        price:
          toNumber(date?.price) ??
          toNumber(date?.["@_price"]) ??
          toNumber(getText(date?.price?.formatted ?? date?.priceFormatted)),
        priceFormatted:
          getText(date?.price?.formatted ?? date?.priceFormatted ?? date?.["@_priceFormatted"]) ??
          getText(date?.price),
        priceMinimumSelling: toNumber(date?.priceMinimumSelling),
        priceMinimumSellingFormatted: getText(date?.priceMinimumSelling?.formatted),
        freeStay: normalizeBoolean(date?.freeStay),
        dayOnRequest: normalizeBoolean(date?.dayOnRequest),
        includedMeals: parseIncludedMeals(date?.including),
      })),
      leftToSell: toNumber(rateBasis?.leftToSell),
      tariffNotes: getText(rateBasis?.tariffNotes),
    }
  })
}

const parseRoomTypes = (roomNode, requestedCurrency) => {
  const roomTypes = ensureArray(roomNode?.roomType)
  return roomTypes.map((roomType) => ({
    runno: roomType?.["@_runno"] ?? null,
    roomTypeCode: roomType?.["@_roomtypecode"] ?? null,
    name: roomType?.name ?? null,
    twin: normalizeBoolean(roomType?.twin),
    roomInfo: {
      maxOccupancy: toNumber(roomType?.roomInfo?.maxOccupancy ?? roomType?.maxOccupancy),
      maxAdults: toNumber(roomType?.roomInfo?.maxAdults ?? roomType?.roomInfo?.maxAdult),
      maxExtraBed: toNumber(roomType?.roomInfo?.maxExtraBed),
      maxChildren: toNumber(roomType?.roomInfo?.maxChildren),
    },
    specialsCount: toNumber(roomType?.specials?.["@_count"]),
    specials: parseSpecials(roomType?.specials),
    rateBases: parseRateBases(roomType?.rateBases, requestedCurrency, parseSpecials(roomType?.specials)),
  }))
}

export const mapGetRoomsResponse = (result) => {
  const currency = result?.currencyShort ?? null
  const hotel = result?.hotel ?? {}
  const roomsNode = ensureArray(hotel?.rooms?.room)

  return {
    currency,
    hotel: {
      id: hotel?.["@_id"] ?? hotel?.id ?? null,
      name: hotel?.["@_name"] ?? hotel?.name ?? null,
      allowBook: normalizeBoolean(hotel?.allowBook),
      rooms: roomsNode.map((room) => ({
        runno: room?.["@_runno"] ?? null,
        count: toNumber(room?.["@_count"]),
        adults: toNumber(room?.["@_adults"]),
        children: toNumber(room?.["@_children"]),
        childrenAges: room?.["@_childrenages"] ?? null,
        extrabeds: toNumber(room?.["@_extrabeds"]),
        lookedForText: room?.lookedForText ?? null,
        from: toNumber(room?.from),
        fromFormatted: getText(room?.from?.formatted),
        roomTypes: parseRoomTypes(room, currency),
      })),
      extraMeals: ensureArray(result?.extraMeals?.mealDate ?? hotel?.extraMeals?.mealDate).map(
        (mealDate) => ({
          datetime: mealDate?.["@_datetime"] ?? mealDate?.datetime ?? null,
          day: mealDate?.["@_day"] ?? mealDate?.day ?? null,
          wday: mealDate?.["@_wday"] ?? mealDate?.wday ?? null,
          mealType: ensureArray(mealDate?.mealType).map((mealType) => ({
            code: mealType?.["@_mealtypecode"] ?? null,
            name: mealType?.["@_mealtypename"] ?? null,
            meals: ensureArray(mealType?.meal).map((meal) => ({
              runno: meal?.["@_runno"] ?? null,
              applicableFor: meal?.["@_applicablefor"] ?? null,
              startAge: toNumber(meal?.["@_startage"]),
              endAge: toNumber(meal?.["@_endage"]),
              mealCode: meal?.mealCode ?? null,
              mealName: meal?.mealName ?? null,
              price: toNumber(meal?.mealPrice),
              priceFormatted: getText(meal?.mealPrice?.formatted),
            })),
          })),
        }),
      ),
    },
  }
}
