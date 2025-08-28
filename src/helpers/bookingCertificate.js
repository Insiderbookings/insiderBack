// src/services/bookingCertificate.js
import PDFDocument from "pdfkit"
import dayjs from "dayjs"

function fmtDate(d) {
  if (!d) return "-"
  return dayjs(d).format("MMM DD, YYYY")
}
function fmtMoney(amount = 0, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount) || 0)
  } catch {
    return `${currency} ${(Number(amount) || 0).toFixed(2)}`
  }
}

function drawLabelValue(doc, { xLabel, xValue, y, label, value }) {
  doc
    .font("Helvetica-Bold").fontSize(9).fillColor("#475569").text(label, xLabel, y)
    .font("Helvetica").fontSize(10).fillColor("#0f172a").text(value ?? "-", xValue, y)
}

function buildPDF(doc, b) {
  const {
    id,
    bookingCode,
    guestName,
    guests,                // { adults, children }
    roomsCount,
    checkIn,
    checkOut,
    hotel = {},
    country = "",
    propertyContact = "",
    currency = "USD",
    totals = {},           // { nights, ratePerNight, taxes, total }
    payment = {},          // { method, last4 }
  } = b

  const nights = totals.nights ?? Math.max(1, dayjs(checkOut).diff(dayjs(checkIn), "day"))
  const total = totals.total ?? 0

  /* Header */
  doc.rect(36, 36, 540, 80).fill("#0f172a")
  doc
    .font("Helvetica-Bold").fontSize(24).fillColor("#fff")
    .text("Insider Bookings", 48, 52)
  doc
    .font("Helvetica").fontSize(14).fillColor("#f97316")
    .text("Booking Confirmation", 48, 82)

  /* Box: details */
  let y = 130
  doc
    .roundedRect(36, y - 10, 540, 190, 8)
    .fillAndStroke("#f8fafc", "#e5e7eb")

  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "🔖 Booking ID", value: bookingCode || id })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "🛏️ Rooms", value: String(roomsCount ?? 1) })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "👤 Guest Name", value: guestName || "-" })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "👥 Guests", value: `${guests?.adults ?? 2}${(guests?.children ?? 0) ? ` (+${guests.children} children)` : ""}` })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "📅 Check-In", value: fmtDate(checkIn) })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "📅 Check-Out", value: fmtDate(checkOut) })

  y += 18
  drawLabelValue(doc, { xLabel: 56,  xValue: 180, y, label: "🌍 Country", value: country || hotel.country || "-" })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "🌙 Nights", value: String(nights) })

  y += 18
  drawLabelValue(doc, { xLabel: 56,  xValue: 180, y, label: "🏨 Property", value: hotel.name || hotel.hotelName || "-" })

  y += 18
  drawLabelValue(doc, {
    xLabel: 56, xValue: 180, y,
    label: "📍 Address",
    value: hotel.address || [hotel.city, hotel.country].filter(Boolean).join(", ") || "-"
  })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "☎️ Contact", value: hotel.phone || propertyContact || "-" })

  /* Cancellation note */
  y += 36
  doc
    .font("Helvetica-Bold").fontSize(10).fillColor("#111")
    .text("Cancellation Policy:", 36, y)
  doc
    .font("Helvetica").fontSize(9).fillColor("#444")
    .text(
      "This booking is non-refundable and cannot be amended. If you fail to arrive or cancel no refund will be given.",
      140, y, { width: 436 }
    )

  /* Rates & Payment box */
  y += 48
  doc
    .roundedRect(36, y, 540, 140, 8)
    .fillAndStroke("#f8fafc", "#e5e7eb")
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text("RATES AND PAYMENT", 48, y + 12)

  const y0 = y + 36
  const colL = 48, colR = 360

  doc
    .font("Helvetica").fontSize(10).fillColor("#0f172a")
    .text(`${nights} night${nights > 1 ? "s" : ""}`, colL, y0)
  doc.fillColor("#475569").text("Insider Rate", colR, y0, { width: 130, align: "right" })
  doc.fillColor("#0f172a").text(fmtMoney(totals.ratePerNight ?? 0, currency), colR + 140, y0, { width: 100, align: "right" })

  doc
    .fillColor("#475569").text("Taxes and Fees", colR, y0 + 18, { width: 130, align: "right" })
  doc.fillColor("#0f172a").text(fmtMoney(totals.taxes ?? 0, currency), colR + 140, y0 + 18, { width: 100, align: "right" })

  doc.moveTo(48, y0 + 40).lineTo(560, y0 + 40).strokeColor("#e5e7eb").stroke()

  doc.font("Helvetica-Bold").fillColor("#0f172a").text("Total Cost", colL, y0 + 50)
  doc.font("Helvetica-Bold").fillColor("#0f172a").text(fmtMoney(total, currency), colR + 140, y0 + 50, { width: 100, align: "right" })

  doc.font("Helvetica").fontSize(10).fillColor("#475569")
    .text("Payment Method", colL, y0 + 74)
  doc.fillColor("#0f172a").text(`${payment.method || "Credit Card"} ${payment.last4 ? `(•••• ${payment.last4})` : ""}`, colR + 140, y0 + 74, { width: 100, align: "right" })

  /* Footer / signature */
  const yF = y0 + 110
  doc.font("Helvetica").fontSize(9).fillColor("#444")
    .text("Please present this booking confirmation upon check-in.", 36, yF)

  doc.moveTo(420, yF + 24).lineTo(560, yF + 24).strokeColor("#e5e7eb").stroke()
  doc.font("Helvetica").fontSize(10).fillColor("#111").text("Authorized Signature", 420, yF + 30)

  // opcional: pie de página
  doc.fontSize(8).fillColor("#aaa").text("© Insider", 36, 760)
}

export function streamCertificatePDF(booking, res) {
  const doc = new PDFDocument({ size: "LETTER", margin: 36 })
  res.setHeader("Content-Type", "application/pdf")
  res.setHeader("Content-Disposition", `attachment; filename=booking-${booking.bookingCode || booking.id}.pdf`)
  doc.pipe(res)
  buildPDF(doc, booking)
  doc.end()
}

export function bufferCertificatePDF(booking) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 36 })
    const chunks = []
    doc.on("data", (c) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    buildPDF(doc, booking)
    doc.end()
  })
}
