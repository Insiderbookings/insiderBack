import { sendMail } from "../helpers/mailer.js"

import { bufferCertificatePDF } from "../helpers/bookingCertificate.js"

import { getBaseEmailTemplate } from "./base-template.js"

import dayjs from "dayjs"



function renderTemplate(template, context) {

  if (!template) return ""

  return String(template).replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {

    const value = key

      .split(".")

      .reduce((acc, part) => (acc != null && acc[part] !== undefined ? acc[part] : undefined), context)

    return value == null ? "" : String(value)

  })

}

const safeText = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

const formatMoney = (amount, currency = "USD") => {
  if (amount == null || amount === "") return null
  const num = Number(amount)
  if (!Number.isFinite(num)) return safeText(amount)
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num)
  } catch {
    return `${currency} ${num.toFixed(2)}`
  }
}

const formatDateLabel = (value) => (value ? dayjs(value).format("MMM DD, YYYY") : null)

const toTitle = (value) => {
  const text = safeText(value)
  if (!text) return null
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const renderTableRows = (rows = []) =>
  rows
    .filter((row) => row && row.value !== null && row.value !== undefined && row.value !== "")
    .map((row) => {
      const valueHtml = row.valueHtml ?? row.value
      return `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${row.label}</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${valueHtml}</td>
      </tr>
    `
    })
    .join("")

const renderSection = (title, rows = []) => {
  const contentRows = renderTableRows(rows)
  if (!contentRows) return ""
  return `
    <h3 style="margin:22px 0 10px;color:#0f172a;font-size:15px;">${title}</h3>
    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      ${contentRows}
    </table>
  `
}

const normalizeLines = (value) => {
  if (!value) return []
  const text = String(value)
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/^[*-]\s*/, "").trim())
    .filter(Boolean)
  return Array.from(new Set(text))
}



export async function sendBookingEmail(booking, toEmail, options = {}) {

  const branding = options.branding || {}

  const attachCertificate = options.attachCertificate !== false && branding.attachCertificate !== false



  const defaultBrandName = process.env.BOOKING_BRAND_NAME || "BookingGPT"
  const brandName = branding.brandName || defaultBrandName

  const guestName = booking.guestName || "Guest"

  const hotelName = booking.hotel?.name || booking.hotel?.hotelName || booking.hotel?.propertyName || "-"

  const hotelAddress =

    booking.hotel?.address || [booking.hotel?.city, booking.hotel?.country].filter(Boolean).join(", ")

  const nights = booking.totals?.nights ?? Math.max(1, dayjs(booking.checkOut).diff(dayjs(booking.checkIn), "day"))

  const totalAmount = Number(booking.totals?.total || 0)

  const guestEmail = safeText(
    booking.guestEmail ??
      booking.guest_email ??
      booking.guest?.email ??
      booking.contact?.email ??
      null,
  )
  const guestPhone = safeText(
    booking.guestPhone ??
      booking.guest_phone ??
      booking.guest?.phone ??
      booking.contact?.phone ??
      null,
  )
  const guestNationality = safeText(booking.guestNationality ?? booking.nationality ?? booking.passengerNationality)
  const guestResidence = safeText(
    booking.guestResidence ??
      booking.countryOfResidence ??
      booking.passengerCountryOfResidence,
  )

  const paymentStatusRaw = safeText(booking.paymentStatus ?? booking.payment_status ?? null)
  const paymentStatusLabel = toTitle(paymentStatusRaw)
  const paymentMethodRaw = safeText(
    booking.payment?.method ??
      booking.paymentMethod ??
      booking.payment_method ??
      booking.payment_provider ??
      null,
  )
  const paymentLast4 = safeText(
    booking.payment?.last4 ??
      booking.paymentLast4 ??
      booking.payment_last4 ??
      booking.cardLast4 ??
      booking.meta?.payment?.last4 ??
      null,
  )
  const paymentMethodLabel = paymentMethodRaw
    ? `${toTitle(paymentMethodRaw) || paymentMethodRaw}${paymentLast4 ? ` (**** ${paymentLast4})` : ""}`
    : null

  const roomName = safeText(
    booking.room?.name ??
      booking.roomName ??
      booking.room_name ??
      booking.room?.roomName ??
      booking.hotel?.roomName ??
      null,
  )
  const ratePlanName = safeText(
    booking.ratePlanName ??
      booking.rate_plan_name ??
      booking.ratePlan ??
      booking.rate_plan ??
      null,
  )
  const boardCode = safeText(booking.boardCode ?? booking.board_code ?? null)
  const paymentTypeRaw = safeText(booking.paymentType ?? booking.payment_type ?? null)
  const paymentTypeLabel = toTitle(paymentTypeRaw)
  const refundability = safeText(booking.refundability ?? booking.cancellation?.badge ?? null)
  const cancellationPolicy = safeText(
    booking.cancellationPolicy ??
      booking.cancellation_policy ??
      booking.policies?.cancellation ??
      booking.policy?.cancellation ??
      null,
  )

  const ratePerNight =
    booking.totals?.ratePerNight ??
    booking.totals?.rate_per_night ??
    booking.ratePerNight ??
    booking.rate_per_night ??
    null
  const taxesAmount =
    booking.totals?.taxes ??
    booking.totals?.taxes_total ??
    booking.taxes ??
    booking.taxes_total ??
    null
  const feesAmount =
    booking.totals?.fees ??
    booking.totals?.fees_total ??
    booking.fees ??
    booking.fees_total ??
    null

  const bookingRef = safeText(booking.bookingRef ?? booking.booking_ref ?? null)
  const externalRef = safeText(booking.externalRef ?? booking.external_ref ?? null)
  const confirmationCode = safeText(
    booking.confirmationCode ??
      booking.confirmation_code ??
      booking.meta?.confirmationCode ??
      booking.meta?.confirmationNumber ??
      booking.meta?.supplierConfirmation ??
      null,
  )



  const context = {

    brandName,

    guestName,

    hotelName,

    bookingCode: booking.bookingCode || booking.id,

    hotelNameOrCode: hotelName && hotelName !== "-" ? hotelName : booking.bookingCode || booking.id,

    checkIn: booking.checkIn,

    checkOut: booking.checkOut,

    checkInDisplay: booking.checkIn ? dayjs(booking.checkIn).format("MMM DD, YYYY") : "-",

    checkOutDisplay: booking.checkOut ? dayjs(booking.checkOut).format("MMM DD, YYYY") : "-",

    totalAmount: totalAmount.toFixed(2),

    currency: booking.currency || "USD",

    nights,

  }



  const introTemplate =

    branding.introText || "Dear {{guestName}}, thank you for choosing {{brandName}}. Below are the details of your stay."

  const intro = renderTemplate(introTemplate, context)



  const adultsCount = Number(booking.guests?.adults ?? booking.adults ?? 2) || 0
  const childrenCount = Number(booking.guests?.children ?? booking.children ?? 0) || 0
  const infantsCount = Number(booking.guests?.infants ?? booking.infants ?? 0) || 0
  const guestParts = []
  if (adultsCount) guestParts.push(`${adultsCount} ${adultsCount === 1 ? "adult" : "adults"}`)
  if (childrenCount) guestParts.push(`${childrenCount} ${childrenCount === 1 ? "child" : "children"}`)
  if (infantsCount) guestParts.push(`${infantsCount} ${infantsCount === 1 ? "infant" : "infants"}`)
  const guestsDisplay = guestParts.length ? guestParts.join(", ") : `${adultsCount || 2}`

  const roomsDisplay = booking.roomsCount ?? booking.rooms ?? 1



  const summaryRows = [
    { label: "Booking ID", value: context.bookingCode },
    { label: "Hotel", value: hotelName },
    ...(hotelAddress ? [{ label: "Address", value: hotelAddress }] : []),
    { label: "Dates", value: `${context.checkInDisplay} - ${context.checkOutDisplay}` },
    { label: "Nights", value: nights != null ? String(nights) : null },
    { label: "Guests / Rooms", value: `${guestsDisplay} / ${roomsDisplay}` },
    ...(paymentStatusLabel ? [{ label: "Payment status", value: paymentStatusLabel }] : []),
    ...(paymentMethodLabel ? [{ label: "Payment method", value: paymentMethodLabel }] : []),
    {
      label: "Total",
      valueHtml: `<strong>${context.currency} ${context.totalAmount}</strong>`,
    },
  ]

  const travelerRows = [
    { label: "Guest", value: guestName },
    ...(guestEmail ? [{ label: "Email", value: guestEmail }] : []),
    ...(guestPhone ? [{ label: "Phone", value: guestPhone }] : []),
    ...(guestNationality ? [{ label: "Nationality", value: guestNationality }] : []),
    ...(guestResidence ? [{ label: "Residence", value: guestResidence }] : []),
  ]

  const rateRows = [
    ...(roomName ? [{ label: "Room", value: roomName }] : []),
    ...(ratePlanName ? [{ label: "Rate plan", value: ratePlanName }] : []),
    ...(boardCode ? [{ label: "Board", value: boardCode }] : []),
    ...(paymentTypeLabel ? [{ label: "Payment type", value: paymentTypeLabel }] : []),
    ...(refundability ? [{ label: "Refundability", value: toTitle(refundability) || refundability }] : []),
    ...(ratePerNight != null ? [{ label: "Rate per night", value: formatMoney(ratePerNight, context.currency) }] : []),
  ]

  const feeRows = [
    ...(taxesAmount != null ? [{ label: "Taxes", value: formatMoney(taxesAmount, context.currency) }] : []),
    ...(feesAmount != null ? [{ label: "Fees", value: formatMoney(feesAmount, context.currency) }] : []),
  ]

  const cancellationLines = normalizeLines(cancellationPolicy)
  const cancellationHtml = cancellationLines.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#334155;line-height:1.6;">
        ${cancellationLines.map((line) => `<li>${line}</li>`).join("")}
      </ul>`
    : cancellationPolicy
      ? `<p style="margin:8px 0 0;color:#334155;line-height:1.6;">${cancellationPolicy}</p>`
      : ""

  const policySection = feeRows.length || cancellationHtml
    ? `
      <h3 style="margin:22px 0 10px;color:#0f172a;font-size:15px;">Policies & fees</h3>
      ${feeRows.length ? `
        <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
          ${renderTableRows(feeRows)}
        </table>
      ` : ""}
      ${cancellationHtml}
    `
    : ""

  const voucherRows = [
    ...(bookingRef ? [{ label: "Booking ref", value: bookingRef }] : []),
    ...(externalRef ? [{ label: "Supplier ref", value: externalRef }] : []),
    ...(confirmationCode ? [{ label: "Confirmation code", value: confirmationCode }] : []),
  ]

  const content = `

    <h2 style="margin:0 0 12px;color:#0f172a;">Booking confirmation</h2>

    <p style="margin:0 0 20px;color:#334155;">

      ${intro}

    </p>

    ${renderSection("Reservation details", summaryRows)}
    ${renderSection("Traveler information", travelerRows)}
    ${renderSection("Rate details", rateRows)}
    ${policySection}
    ${renderSection("Voucher & references", voucherRows)}

    <p style="margin:24px 0 0;color:#334155;">

      ${branding.footerIntroText || "We look forward to hosting you. Attached you'll find your booking confirmation PDF."}

    </p>

  `



  const html = getBaseEmailTemplate(

    content,

    branding.emailTitle || "Booking Confirmation",

    {

      brandName,

      primaryColor: branding.primaryColor,

      accentColor: branding.accentColor,

      logoUrl: branding.logoUrl,

      headerTitle: branding.headerTitle,

      headerSubtitle: branding.headerSubtitle,

      tagline: branding.tagline,

      footerText: branding.footerText,

      supportText: branding.supportText,

      backgroundColor: branding.backgroundColor,

      bodyBackground: branding.bodyBackground,

      textColor: branding.textColor,

      headerAlign: branding.headerAlign,

      headerExtraHtml: branding.headerExtraHtml,

      footerExtraHtml: branding.footerExtraHtml,

      socialLinks: branding.socialLinks,

    },

  )



  const attachments = []

  if (attachCertificate) {

    const pdfBuffer = await bufferCertificatePDF(booking, {

      brandName,

      headerColor: branding.primaryColor,

      accentColor: branding.accentColor,

      headerTagline: branding.pdfTagline || branding.tagline || "Booking Confirmation",

      footerNote: branding.pdfFooterText || branding.footerText || `\u00a9 ${new Date().getFullYear()} ${brandName}`,

      rateLabel: branding.rateLabel,

      taxLabel: branding.taxLabel,

      totalLabel: branding.totalLabel,

      paymentLabel: branding.paymentLabel,

    })

    attachments.push({

      filename: `booking-${context.bookingCode}.pdf`,

      content: pdfBuffer,

      contentType: "application/pdf",

    })

  }



  const subjectTemplate = branding.subjectTemplate || null

  const subjectPrefix = branding.subjectPrefix || brandName

  const fallbackSubject = `${subjectPrefix} Booking Confirmation - ${context.hotelNameOrCode}`

  const subject = subjectTemplate ? renderTemplate(subjectTemplate, context) : fallbackSubject



  const mailFromEnv = process.env.MAIL_FROM || null
  const fromEmail =
    branding.fromEmail ||
    process.env.MAIL_FROM_EMAIL ||
    (mailFromEnv && !mailFromEnv.includes("<") ? mailFromEnv : null) ||
    process.env.SMTP_USER ||
    null

  const fromName = branding.fromName || brandName

  const formattedFrom = fromEmail
    ? `${fromName} <${fromEmail}>`
    : mailFromEnv && mailFromEnv.includes("<")
      ? mailFromEnv
      : undefined



  await sendMail({

    to: toEmail,

    subject,

    html,

    ...(attachments.length ? { attachments } : {}),

    ...(formattedFrom ? { from: formattedFrom } : {}),

    ...(branding.replyTo ? { replyTo: branding.replyTo } : {}),

    ...(branding.cc ? { cc: branding.cc } : {}),

    ...(branding.bcc ? { bcc: branding.bcc } : {}),

    smtp: branding.smtp,

  })

}

