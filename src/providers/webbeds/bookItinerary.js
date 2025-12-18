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

const cleanObject = (obj = {}) => {
  const copy = { ...obj }
  Object.keys(copy).forEach((key) => {
    if (copy[key] === undefined || copy[key] === null) {
      delete copy[key]
    }
  })
  return copy
}

// Normaliza avsDetails y asegura orden esperado por XSD (avsFirstName, avsLastName, avsAddress, avsZip, avsCountry, avsCity, avsEmail, avsPhone)
const buildAvsDetails = (avs = {}) => {
  // Permitimos alias comunes
  const first = avs.avsFirstName ?? avs.firstName ?? avs.name ?? ""
  const last = avs.avsLastName ?? avs.lastName ?? ""
  const address = avs.avsAddress ?? avs.address ?? ""
  const zip = avs.avsZip ?? avs.zip ?? ""
  const country = avs.avsCountry ?? avs.country ?? ""
  const city = avs.avsCity ?? avs.city ?? ""
  const email = avs.avsEmail ?? avs.email ?? ""
  const phone = avs.avsPhone ?? avs.phone ?? ""

  const ordered = {
    avsFirstName: String(first),
    avsLastName: String(last),
    avsAddress: String(address),
    avsZip: String(zip),
    avsCountry: String(country),
    avsCity: String(city),
    avsEmail: String(email),
    avsPhone: String(phone),
  }

  // No eliminamos vacíos para mantener el orden de nodos (XSD sequence). Si quieres omitirlos, ajusta aquí.
  return ordered
}

const buildCreditCardPaymentDetails = ({
  paymentMethod,
  usedCredit = 0,
  creditCardCharge,
  token,
  cardHolderName,
  creditCardType,
  avsDetails,
  authorisationId,
  authorizationId,
  orderCode,
  devicePayload,
  endUserIPAddress,
} = {}, { onlyOrderAndAuth = false } = {}) => {
  if (!paymentMethod && creditCardCharge === undefined && !token && !orderCode) return null

  const resolvedAuthorisationId = authorisationId ?? authorizationId

  const payment = {
    paymentMethod: paymentMethod || "CC_PAYMENT_COMMISSIONABLE",
    usedCredit: String(usedCredit ?? 0),
    creditCardCharge: creditCardCharge != null ? String(creditCardCharge) : "0",
  }

  // Orden estricto para XML: token -> avsDetails (orderCode no va aqui)
  const details = {}

  if (onlyOrderAndAuth) {
    // Caso especifico solicitado: SOLO orderCode y authorisationId
    if (orderCode) details.orderCode = orderCode
    if (resolvedAuthorisationId) details.authorisationId = resolvedAuthorisationId
  } else {
    if (token) details.token = token
    if (creditCardType) details.creditCardType = creditCardType
    if (cardHolderName) details.creditCardHolderName = cardHolderName
    if (avsDetails) details.avsDetails = buildAvsDetails(avsDetails)
  }

  if (Object.keys(details).length) {
    payment.creditCardDetails = details
  }

  if (devicePayload) payment.devicePayload = devicePayload
  if (endUserIPAddress) payment.endUserIPv4Address = endUserIPAddress

  return payment
}

const toText = (value) => {
  if (value == null) return null
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (typeof value === "object") {
    return (
      value["#"] ??
      value["#text"] ??
      value.text ??
      value.formatted ??
      value.value ??
      value.amount ??
      null
    )
  }
  return null
}

export const buildBookItineraryPayload = ({
  bookingCode,
  bookingType,
  confirm = "yes",
  sendCommunicationTo,
  payment = {},
  services = [],
} = {}) => {
  if (!bookingCode) {
    throw new Error("WebBeds bookitinerary requires bookingCode")
  }

  const confirmValue = String(confirm || "").trim().toLowerCase()
  const confirmNormalized = ["no", "preauth"].includes(confirmValue) ? confirmValue : "yes"

  // DOTW: 1 = Confirmed, 2 = Saved. Para nuestro flujo preferimos default 2.
  const finalBookingType = bookingType !== undefined && bookingType !== null
    ? Number(bookingType)
    : 2

  const bookingDetails = {
    bookingType: finalBookingType,
    bookingCode: String(bookingCode),
    confirm: confirmNormalized,
  }

  const communicationEmail = sendCommunicationTo?.trim?.() || undefined
  if (communicationEmail) {
    bookingDetails.sendCommunicationTo = communicationEmail
  }

  // Para confirm="yes" reenviamos precios/asignación.
  const servicesArray = ensureArray(services)
  if (["preauth", "yes"].includes(confirmNormalized) && servicesArray.length) {
    bookingDetails.testPricesAndAllocation = {
      service: servicesArray.map((svc) => ({
        "@referencenumber":
          svc.serviceCode ??
          svc.returnedServiceCode ??
          svc.referenceNumber ??
          svc.reference ??
          svc.bookingCode ??
          undefined,
        testPrice: svc.testPrice ?? svc.servicePrice ?? svc.price ?? undefined,
        penaltyApplied: svc.penaltyApplied ?? undefined,
        allocationDetails: svc.allocationDetails ?? undefined,
        paymentBalance: svc.paymentBalance ?? undefined,
      })),
    }
  }

  const paymentNode = buildCreditCardPaymentDetails(payment, {
    onlyOrderAndAuth: confirmNormalized === "yes"
  })

  if (paymentNode) {
    if (confirmNormalized !== "preauth") {
      delete paymentNode.devicePayload
      delete paymentNode.endUserIPv4Address
    }
    bookingDetails.creditCardPaymentDetails = paymentNode
  }

  return { bookingDetails }
}

export const buildBookItineraryPreauthPayload = (params = {}) => {
  // Same structure but command is bookitinerary_preauth and confirm is not required.
  // We still send dates/currency if provided.
  const payload = buildBookItineraryPayload({
    ...params,
    confirm: "preauth",
  })
  return payload
}

export const mapBookItineraryResponse = (result = {}) => {
  const normalizePrice = (node) => {
    if (node == null) return null
    if (typeof node === "string") return node
    if (node["#text"]) return node["#text"]
    if (node.formatted) return node.formatted
    return node
  }

  const threeDSRaw = result?.threeDSData ?? null

  const authId =
    toText(threeDSRaw?.authorisationId) ??
    toText(threeDSRaw?.authorizationId) ??
    null

  const threeDSData = threeDSRaw
    ? {
      initiate3DS: toText(threeDSRaw?.initiate3DS),
      token: toText(threeDSRaw?.token),
      status: toText(threeDSRaw?.status),
      orderCode: toText(threeDSRaw?.orderCode),
      authorizationId: authId,
    }
    : null

  const mapDates = (datesNode) => {
    const dates = ensureArray(datesNode?.date)
    return dates.map((d) => ({
      runno: d?.["@_runno"] ?? null,
      datetime: d?.["@_datetime"] ?? null,
      day: d?.["@_day"] ?? null,
      wday: d?.["@_wday"] ?? null,
      price: normalizePrice(d?.price),
      priceMinimumSelling: normalizePrice(d?.priceMinimumSelling),
      freeStay: d?.freeStay ?? null,
      dayOnRequest: d?.dayOnRequest ?? null,
    }))
  }

  const bookings = ensureArray(result?.bookings?.booking).map((b) => ({
    bookingCode: b?.bookingCode ?? null,
    bookingReferenceNumber: b?.bookingReferenceNumber ?? null,
    bookingStatus: b?.bookingStatus ?? null,
    price: normalizePrice(b?.price),
    servicePrice: normalizePrice(b?.servicePrice),
    mealsPrice: normalizePrice(b?.mealsPrice),
    totalTaxes: normalizePrice(b?.totalTaxes),
    totalFee: normalizePrice(b?.totalFee),
    voucher: b?.voucher ?? null,
    paymentGuaranteedBy: b?.paymentGuaranteedBy ?? null,
    currency: b?.currency ?? null,
    type: b?.type ?? null,
    emergencyContacts: ensureArray(b?.emergencyContacts?.emergencyContact).map((c) => ({
      runno: c?.["@_runno"] ?? null,
      salutationId: c?.salutation?.["@_id"] ?? null,
      salutation: c?.salutation?.["#"] ?? c?.salutation ?? null,
      fullName: c?.fullName ?? null,
      phone: c?.phone ?? null,
    })),
  }))

  const services = ensureArray(
    result?.returnedServiceCodes?.returnedServiceCode
  ).map((svc, idx) => {
    // Webbeds a veces devuelve el string directo, o string dentro de '#text', o objeto con atributo
    const val = toText(svc)
    return {
      code: String(svc?.["@_runno"] ?? idx),
      returnedServiceCode: val
    }
  })

  return {
    currencyShort: result?.currencyShort ?? null,
    confirmationText: result?.confirmationText ?? null,
    returnedCode: result?.returnedCode ?? null,
    services,
    orderCode: threeDSData?.orderCode ?? toText(result?.orderCode),
    authorizationId:
      threeDSData?.authorizationId ??
      toText(result?.authorisationId ?? result?.authorizationId),
    successful: normalizeBoolean(result?.successful),
    threeDSData,
    bookings,
    products: ensureArray(result?.product),
    metadata: {
      command: result?.["@_command"] ?? null,
      transactionId: result?.["@_tID"] ?? null,
      ip: result?.["@_ip"] ?? null,
      date: result?.["@_date"] ?? null,
      version: result?.["@_version"] ?? null,
      elapsedTime: result?.["@_elapsedTime"] ?? null,
    },
  }
}
