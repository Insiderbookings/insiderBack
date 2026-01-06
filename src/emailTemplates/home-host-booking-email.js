import { sendMail } from "../helpers/mailer.js"
import { getBaseEmailTemplate } from "./base-template.js"
import dayjs from "dayjs"

const fmtDate = (value) => (value ? dayjs(value).format("MMM DD, YYYY") : "-")

const fmtMoney = (amount = 0, currency = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount) || 0)
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`
  }
}

const safe = (value) => (value == null || value === "" ? "-" : String(value))

export async function sendHomeHostBookingEmail(payload = {}, options = {}) {
  const {
    toEmail,
    hostName,
    bookingCode,
    homeName,
    homeAddress,
    checkIn,
    checkOut,
    nights,
    guests,
    total,
    currency,
    guestName,
    guestEmail,
    guestPhone,
    securityDeposit,
  } = payload

  if (!toEmail) return

  const guestLineParts = [
    safe(guestName),
    safe(guestEmail),
    guestPhone ? safe(guestPhone) : null,
  ].filter(Boolean)
  const guestLine = guestLineParts.join(" | ")

  const guestsDisplay = `${Number(guests?.adults ?? 0)} adults` +
    (Number(guests?.children ?? 0) ? ` + ${Number(guests.children)} children` : "") +
    (Number(guests?.infants ?? 0) ? ` + ${Number(guests.infants)} infants` : "")

  const content = `
    <h2 style="margin:0 0 12px;color:#0f172a;">New home booking received</h2>
    <p style="margin:0 0 20px;color:#334155;">
      Hi ${safe(hostName || "Host")}, a new booking was created for your listing.
    </p>

    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Booking ID</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${safe(bookingCode)}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Listing</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${safe(homeName)}</td>
      </tr>
      ${homeAddress ? `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Address</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${safe(homeAddress)}</td>
      </tr>
      ` : ""}
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Dates</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">
          ${fmtDate(checkIn)} - ${fmtDate(checkOut)}${Number(nights) ? ` (${Number(nights)} nights)` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Guests</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${guestsDisplay}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Total</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;"><strong>${fmtMoney(total, currency || "USD")}</strong></td>
      </tr>
      ${Number(securityDeposit) ? `
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Security Deposit</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${fmtMoney(securityDeposit, currency || "USD")}</td>
      </tr>
      ` : ""}
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Guest Contact</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${safe(guestLine)}</td>
      </tr>
    </table>

    <p style="margin:24px 0 0;color:#334155;">
      Please review this booking in your host dashboard for full details.
    </p>
  `

  const html = getBaseEmailTemplate(
    content,
    options.emailTitle || "New home booking",
    {
      brandName: options.brandName || "Insider Bookings",
      primaryColor: options.primaryColor,
      accentColor: options.accentColor,
      logoUrl: options.logoUrl,
      headerTitle: options.headerTitle,
      headerSubtitle: options.headerSubtitle,
      tagline: options.tagline,
      footerText: options.footerText,
      supportText: options.supportText,
      backgroundColor: options.backgroundColor,
      bodyBackground: options.bodyBackground,
      textColor: options.textColor,
      headerAlign: options.headerAlign,
      headerExtraHtml: options.headerExtraHtml,
      footerExtraHtml: options.footerExtraHtml,
      socialLinks: options.socialLinks,
    },
  )

  const subject = options.subject || `New home booking - ${safe(homeName || bookingCode)}`

  await sendMail({
    to: toEmail,
    subject,
    html,
    ...(options.from ? { from: options.from } : {}),
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    ...(options.cc ? { cc: options.cc } : {}),
    ...(options.bcc ? { bcc: options.bcc } : {}),
    smtp: options.smtp,
  })
}
