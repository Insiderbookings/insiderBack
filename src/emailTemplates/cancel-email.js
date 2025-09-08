import { sendMail } from "../helpers/mailer.js"
import { getBaseEmailTemplate } from "./base-template.js"
import dayjs from "dayjs"

function fmt(d, lang = "en") {
  try { return dayjs(d).format(lang === 'es' ? 'DD MMM YYYY' : 'MMM DD, YYYY') } catch { return String(d || '-') }
}

function money(n, ccy = "USD") {
  const v = Number(n) || 0
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: ccy }).format(v) }
  catch { return `${ccy} ${v.toFixed(2)}` }
}

function renderPolicy(policy, lang = 'en') {
  if (!policy) return ''
  const t = {
    en: { title: 'Cancellation Policy', refundable: 'Refundable', nonref: 'Non-refundable', until: 'until', penalty: 'Penalty', deadline: 'Deadline' },
    es: { title: 'Política de cancelación', refundable: 'Reembolsable', nonref: 'No reembolsable', until: 'hasta', penalty: 'Penalidad', deadline: 'Fecha límite' },
  }[lang] || {};

  const refundable = policy?.refundable === true
  const rows = (policy?.cancelPenalties || []).map((p) => {
    const val = p?.value != null ? `${money(p.value, p.currency || 'USD')}` : (p?.penaltyType || '-')
    const dl  = p?.deadline ? fmt(p.deadline, lang) : '-'
    return `<tr><td style="padding:6px;border:1px solid #e2e8f0;">${t.deadline}</td><td style="padding:6px;border:1px solid #e2e8f0;">${dl}</td></tr>
            <tr><td style="padding:6px;border:1px solid #e2e8f0;">${t.penalty}</td><td style="padding:6px;border:1px solid #e2e8f0;">${val}</td></tr>`
  }).join('')

  return `
    <h3 style="margin:24px 0 8px;color:#0f172a;">${t.title}</h3>
    <p style="margin:0 0 12px;color:#334155;">${refundable ? t.refundable : t.nonref}</p>
    ${rows ? `<table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">${rows}</table>` : ''}
  `
}

export async function sendCancellationEmail({ booking, toEmail, lang = (process.env.DEFAULT_LANG || 'en'), policy = null, refund = {} }) {
  const t = {
    en: {
      title: 'Booking Cancellation',
      hello: 'Dear',
      lead: 'Your booking has been cancelled successfully. Below are the details and refund information.',
      bookingId: 'Booking ID', hotel: 'Hotel', dates: 'Dates', guestsRooms: 'Guests / Rooms', total: 'Total',
      refundTitle: 'Refund', refundAmount: 'Refund amount', refundMethod: 'Method', refundWhen: 'Expected timeline',
      refundWhenHint: '3–5 business days to appear on your statement (depending on the bank).',
    },
    es: {
      title: 'Cancelación de reserva',
      hello: 'Hola',
      lead: 'Hemos cancelado tu reserva. A continuación verás el detalle y la información del reembolso.',
      bookingId: 'Código de reserva', hotel: 'Hotel', dates: 'Fechas', guestsRooms: 'Huéspedes / Habitaciones', total: 'Total',
      refundTitle: 'Reembolso', refundAmount: 'Importe a devolver', refundMethod: 'Método', refundWhen: 'Plazo estimado',
      refundWhenHint: 'Entre 3 y 5 días hábiles para verse en el extracto (según el banco).',
    }
  }[lang] || {};

  const content = `
    <h2 style="margin:0 0 12px;color:#0f172a;">${t.title}</h2>
    <p style="margin:0 0 20px;color:#334155;">${t.hello} ${booking.guestName || 'Guest'}, ${t.lead}</p>

    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.bookingId}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${booking.bookingCode || booking.id}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.hotel}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${booking.hotel?.name || '-'}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.dates}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${fmt(booking.checkIn, lang)} – ${fmt(booking.checkOut, lang)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.guestsRooms}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${booking.guests?.adults ?? 2}${booking.guests?.children ? ` +${booking.guests.children}` : ''} / ${booking.roomsCount ?? 1}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.total}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;"><strong>${booking.currency} ${(Number(booking.totals?.total || 0)).toFixed(2)}</strong></td></tr>
    </table>

    <h3 style="margin:24px 0 8px;color:#0f172a;">${t.refundTitle}</h3>
    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;">
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.refundAmount}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${money(refund.amount ?? booking.totals?.refundAmount ?? 0, refund.currency || booking.currency)}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.refundMethod}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${refund.method || 'Original payment method'}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e2e8f0;background-color:#f8fafc;">${t.refundWhen}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;">${refund.when || t.refundWhenHint}</td></tr>
    </table>

    ${renderPolicy(policy, lang)}
  `

  const html = getBaseEmailTemplate(content, t.title)

  await sendMail({
    to: toEmail,
    subject: `${t.title} – ${booking.bookingCode || booking.id}`,
    html,
  })
}

