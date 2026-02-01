import dayjs from "dayjs"

const safeText = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

const diffNights = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return null
  const inDate = dayjs(checkIn)
  const outDate = dayjs(checkOut)
  if (!inDate.isValid() || !outDate.isValid()) return null
  const nights = outDate.diff(inDate, "day")
  return nights > 0 ? nights : null
}

export const buildBookingEmailPayload = (booking) => {
  if (!booking) return null
  const raw = booking?.toJSON ? booking.toJSON() : booking

  const hotelStay = raw.hotelStay || raw.StayHotel || raw.stayHotel || null
  const webHotel = hotelStay?.webbedsHotel || null
  const hotel = hotelStay?.hotel || raw.hotel || raw.Hotel || null
  const metaHotel = raw.meta?.snapshot || raw.meta?.hotel || raw.meta?.hotelSnapshot || {}

  const hotelName =
    hotel?.name ||
    webHotel?.name ||
    metaHotel?.hotelName ||
    metaHotel?.name ||
    raw.hotel_name ||
    "Hotel"
  const hotelCity = hotel?.city || webHotel?.city_name || metaHotel?.city || null
  const hotelCountry = hotel?.country || webHotel?.country_name || metaHotel?.country || null
  const hotelAddress =
    hotel?.address ||
    webHotel?.address ||
    metaHotel?.address ||
    [hotelCity, hotelCountry].filter(Boolean).join(", ") ||
    null
  const hotelPhone = hotel?.phone || metaHotel?.phone || null

  const roomSnapshot =
    hotelStay?.room_snapshot ||
    raw.inventory_snapshot?.room ||
    raw.meta?.roomSnapshot ||
    raw.meta?.room_snapshot ||
    null

  const roomName =
    hotelStay?.room_name ||
    roomSnapshot?.name ||
    roomSnapshot?.roomName ||
    roomSnapshot?.room_name ||
    null
  const ratePlanName =
    hotelStay?.rate_plan_name ||
    roomSnapshot?.ratePlanName ||
    roomSnapshot?.rate_plan_name ||
    null
  const boardCode =
    hotelStay?.board_code ||
    roomSnapshot?.boardCode ||
    roomSnapshot?.board_code ||
    null
  const cancellationPolicy =
    hotelStay?.cancellation_policy ||
    roomSnapshot?.cancellationPolicy ||
    raw.meta?.cancellationPolicy ||
    raw.meta?.cancellation_policy ||
    null

  const currency = raw.currency || "USD"
  const nights = Number(raw.nights) || diffNights(raw.check_in || raw.checkIn, raw.check_out || raw.checkOut) || null
  const total = Number(raw.gross_price ?? raw.totals?.total ?? 0)
  const baseSubtotal = Number(
    raw.pricing_snapshot?.baseSubtotal ??
      raw.pricing_snapshot?.base_subtotal ??
      raw.pricing_snapshot?.subTotal ??
      0,
  )
  const ratePerNight =
    nights && baseSubtotal
      ? Number((baseSubtotal / nights).toFixed(2))
      : nights && total
        ? Number((total / nights).toFixed(2))
        : null
  const taxes =
    raw.taxes_total ??
    raw.pricing_snapshot?.taxAmount ??
    raw.pricing_snapshot?.tax_amount ??
    null
  const fees =
    raw.fees_total ??
    raw.pricing_snapshot?.feesTotal ??
    raw.pricing_snapshot?.fees_total ??
    null

  const payload = {
    id: raw.id,
    bookingCode: raw.booking_ref || raw.id,
    bookingRef: raw.booking_ref || null,
    externalRef: raw.external_ref || null,
    confirmationCode:
      raw.meta?.confirmationCode ||
      raw.meta?.confirmationNumber ||
      raw.meta?.supplierConfirmation ||
      null,
    guestName: raw.guest_name || raw.guestName || null,
    guestEmail: raw.guest_email || raw.guestEmail || null,
    guestPhone: raw.guest_phone || raw.guestPhone || null,
    guests: {
      adults: raw.adults ?? raw.guests?.adults ?? null,
      children: raw.children ?? raw.guests?.children ?? null,
      infants: raw.infants ?? raw.guests?.infants ?? null,
    },
    roomsCount: raw.rooms ?? raw.roomsCount ?? 1,
    checkIn: raw.check_in || raw.checkIn,
    checkOut: raw.check_out || raw.checkOut,
    hotel: {
      name: hotelName,
      address: hotelAddress,
      city: hotelCity,
      country: hotelCountry,
      phone: hotelPhone,
    },
    currency,
    totals: {
      total,
      nights,
      ratePerNight,
      taxes,
      fees,
    },
    paymentStatus: raw.payment_status || raw.paymentStatus || null,
    payment: {
      method: raw.payment_provider || raw.meta?.payment?.method || null,
      last4: raw.meta?.payment?.last4 || raw.payment_last4 || null,
    },
    roomName,
    ratePlanName,
    boardCode,
    paymentType: raw.meta?.paymentType || raw.meta?.payment_type || null,
    cancellationPolicy,
  }

  payload.hotel = payload.hotel || {}
  if (!payload.hotel.address) {
    const addressText = [payload.hotel.city, payload.hotel.country].filter(Boolean).join(", ")
    payload.hotel.address = addressText || null
  }

  if (payload.payment && !safeText(payload.payment.method)) {
    payload.payment.method = null
  }

  return payload
}
