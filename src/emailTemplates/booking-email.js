import { sendMail } from "../helpers/mailer.js"
import { bufferCertificatePDF } from "../helpers/bookingCertificate.js"
import { getBaseEmailTemplate } from "./base-template.js"
import dayjs from "dayjs"

export async function sendBookingEmail(booking, toEmail) {
  const pdfBuffer = await bufferCertificatePDF(booking)

  const content = `
    <h2 style="margin:0 0 12px;color:#0f172a;">Booking confirmation</h2>
    <p style="margin:0 0 20px;color:#334155;">
      Dear ${booking.guestName || "Guest"}, thank you for choosing Insider Bookings. Below are the details of your stay.
    </p>

    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Booking ID</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${booking.bookingCode || booking.id}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Hotel</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${booking.hotel?.name || "-"}</td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Dates</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">
          ${dayjs(booking.checkIn).format("MMM DD, YYYY")} – ${dayjs(booking.checkOut).format("MMM DD, YYYY")}
        </td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Guests / Rooms</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">
          ${booking.guests?.adults ?? 2}${booking.guests?.children ? ` +${booking.guests.children}` : ""} / ${booking.roomsCount ?? 1}
        </td>
      </tr>
      <tr>
        <td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">Total</td>
        <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;"><strong>${booking.currency} ${Number(booking.totals?.total || 0).toFixed(2)}</strong></td>
      </tr>
    </table>

    <p style="margin:24px 0 0;color:#334155;">
      We look forward to hosting you. Attached you'll find your booking confirmation PDF.
    </p>
  `

  const html = getBaseEmailTemplate(content, "Booking Confirmation")

  await sendMail({
    to: toEmail,
    subject: `Booking Confirmation – ${booking.hotel?.name || booking.bookingCode || booking.id}`,
    html,
    attachments: [
      {
        filename: `booking-${booking.bookingCode || booking.id}.pdf`,
        content : pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  })
}
