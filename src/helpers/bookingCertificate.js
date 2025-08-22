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
    .font("Helvetica-Bold").fontSize(9).fillColor("#111").text(label, xLabel, y)
    .font("Helvetica").fontSize(10).fillColor("#222").text(value ?? "-", xValue, y)
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
  doc.rect(36, 36, 540, 60).fill("#fff")
  doc
    .font("Helvetica-Bold").fontSize(22).fillColor("#111")
    .text("Insider", 36, 44)
  doc
    .font("Helvetica-Bold").fontSize(18).fillColor("#f97316")
    .text("BOOKING CONFIRMATION", 36, 76)

  /* Box: details */
  let y = 120
  doc.lineWidth(0.5).strokeColor("#e5e7eb").roundedRect(36, y - 10, 540, 190, 8).stroke()

  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "Booking ID", value: bookingCode || id })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "Number of Rooms", value: String(roomsCount ?? 1) })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "Guest Name", value: guestName || "-" })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "Number of Guests", value: `${guests?.adults ?? 2}${(guests?.children ?? 0) ? ` (+${guests.children} children)` : ""}` })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "Check-In Date", value: fmtDate(checkIn) })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "Check-Out Date", value: fmtDate(checkOut) })

  y += 18
  drawLabelValue(doc, { xLabel: 56,  xValue: 180, y, label: "Country of Residence", value: country || hotel.country || "-" })
  drawLabelValue(doc, { xLabel: 310, xValue: 420, y, label: "Nights", value: String(nights) })

  y += 18
  drawLabelValue(doc, { xLabel: 56,  xValue: 180, y, label: "Property", value: hotel.name || hotel.hotelName || "-" })

  y += 18
  drawLabelValue(doc, {
    xLabel: 56, xValue: 180, y,
    label: "Address",
    value: hotel.address || [hotel.city, hotel.country].filter(Boolean).join(", ") || "-"
  })

  y += 18
  drawLabelValue(doc, { xLabel: 56, xValue: 180, y, label: "Property Contact", value: hotel.phone || propertyContact || "-" })

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
  doc.roundedRect(36, y, 540, 140, 8).strokeColor("#e5e7eb").stroke()
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#111").text("RATES AND PAYMENT", 48, y + 10)

  const y0 = y + 36
  const colL = 48, colR = 360

  doc
    .font("Helvetica").fontSize(10).fillColor("#111")
    .text(`${nights} night${nights > 1 ? "s" : ""}`, colL, y0)
  doc.text("Insider Rate", colR, y0, { width: 130, align: "right" })
  doc.text(fmtMoney(totals.ratePerNight ?? 0, currency), colR + 140, y0, { width: 100, align: "right" })

  doc
    .text("Taxes and Fees", colR, y0 + 18, { width: 130, align: "right" })
  doc.text(fmtMoney(totals.taxes ?? 0, currency), colR + 140, y0 + 18, { width: 100, align: "right" })

  doc.moveTo(48, y0 + 40).lineTo(560, y0 + 40).strokeColor("#e5e7eb").stroke()

  doc.font("Helvetica-Bold").text("Total Cost", colL, y0 + 50)
  doc.font("Helvetica-Bold").text(fmtMoney(total, currency), colR + 140, y0 + 50, { width: 100, align: "right" })

  doc.font("Helvetica").fontSize(10).fillColor("#111")
    .text("Payment Method", colL, y0 + 74)
  doc.text(`${payment.method || "Credit Card"} ${payment.last4 ? `(•••• ${payment.last4})` : ""}`, colR + 140, y0 + 74, { width: 100, align: "right" })

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
