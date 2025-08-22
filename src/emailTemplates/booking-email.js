import { sendMail } from "../helpers/mailer.js"
import { bufferCertificatePDF } from "../helpers/bookingCertificate.js"
import dayjs from "dayjs"

export async function sendBookingEmail(booking, toEmail) {
  const pdfBuffer = await bufferCertificatePDF(booking)

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif">
    <h2 style="margin:0 0 8px">Booking Confirmation</h2>
    <p style="margin:0 0 12px;color:#444">
      Hi ${booking.guestName || "Guest"}, your reservation is confirmed.
    </p>

    <table style="border-collapse:collapse;width:100%;max-width:560px">
      <tr>
        <td style="padding:6px 0;color:#888">Booking ID</td>
        <td style="padding:6px 0;text-align:right"><strong>${booking.bookingCode || booking.id}</strong></td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#888">Hotel</td>
        <td style="padding:6px 0;text-align:right">${booking.hotel?.name || "-"}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#888">Dates</td>
        <td style="padding:6px 0;text-align:right">
          ${dayjs(booking.checkIn).format("MMM DD, YYYY")} – ${dayjs(booking.checkOut).format("MMM DD, YYYY")}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#888">Guests / Rooms</td>
        <td style="padding:6px 0;text-align:right">
          ${booking.guests?.adults ?? 2}${booking.guests?.children ? ` +${booking.guests.children}` : ""} / ${booking.roomsCount ?? 1}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;color:#888">Total</td>
        <td style="padding:6px 0;text-align:right"><strong>${booking.currency} ${Number(booking.totals?.total || 0).toFixed(2)}</strong></td>
      </tr>
    </table>

    <p style="margin:16px 0;color:#555">
      Attached you'll find your Booking Confirmation PDF. Please present it upon check-in.
    </p>
  </div>
  `

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