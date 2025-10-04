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

export async function sendBookingEmail(booking, toEmail, options = {}) {
  const branding = options.branding || {}
  const attachCertificate = options.attachCertificate !== false && branding.attachCertificate !== false

  const brandName = branding.brandName || "Insider Bookings"
  const guestName = booking.guestName || "Guest"
  const hotelName = booking.hotel?.name || booking.hotel?.hotelName || booking.hotel?.propertyName || "-"
  const nights = booking.totals?.nights ?? Math.max(1, dayjs(booking.checkOut).diff(dayjs(booking.checkIn), "day"))
  const totalAmount = Number(booking.totals?.total || 0)

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

  const guestsDisplay = `${booking.guests?.adults ?? 2}${booking.guests?.children ? ` +${booking.guests.children}` : ""}`
  const roomsDisplay = booking.roomsCount ?? 1

  const content = `
    <h2 style="margin:0 0 12px;color:#0f172a;">Booking confirmation</h2>
    <p style="margin:0 0 20px;color:#334155;">
      ${intro}
    </p>

    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Booking ID</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${context.bookingCode}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Hotel</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${hotelName}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Dates</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">
          ${context.checkInDisplay} - ${context.checkOutDisplay}
        </td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Guests / Rooms</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${guestsDisplay} / ${roomsDisplay}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Total</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;"><strong>${context.currency} ${context.totalAmount}</strong></td>
      </tr>
    </table>

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
      footerNote: branding.pdfFooterText || branding.footerText || `© ${new Date().getFullYear()} ${brandName}`,
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

  const fromEmail = branding.fromEmail || null
  const fromName = branding.fromName || brandName
  const formattedFrom = fromEmail ? `${fromName} <${fromEmail}>` : undefined

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
