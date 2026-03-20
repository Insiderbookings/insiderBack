import { getBaseEmailTemplate } from "./base-template.js";

const safeText = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatGuests = ({ adults = 0, children = 0 } = {}) => {
  const parts = [];
  if (Number(adults) > 0) {
    parts.push(`${Number(adults)} adult${Number(adults) === 1 ? "" : "s"}`);
  }
  if (Number(children) > 0) {
    parts.push(`${Number(children)} child${Number(children) === 1 ? "" : "ren"}`);
  }
  return parts.join(" | ") || null;
};

export const getBookingAbandonmentEmailTemplate = ({
  hotelName,
  reminderLabel,
  ctaUrl,
  checkIn,
  checkOut,
  guests,
} = {}) => {
  const stayTitle = safeText(hotelName) || "your hotel";
  const guestsLabel = formatGuests(guests);
  const content = `
    <h2 style="margin:0 0 12px;font-size:24px;color:#0f172a;">Still thinking about ${escapeHtml(stayTitle)}?</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
      ${escapeHtml(reminderLabel || "Your selected stay is still available for now, but rates may change soon.")}
    </p>
    <table style="border-collapse:collapse;width:100%;max-width:560px;font-size:14px;margin:20px 0;">
      ${checkIn ? `<tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Check-in</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(checkIn)}</td></tr>` : ""}
      ${checkOut ? `<tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Check-out</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(checkOut)}</td></tr>` : ""}
      ${guestsLabel ? `<tr><td style="padding:8px;border:1px solid #e2e8f0;background:#f8fafc;">Guests</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(guestsLabel)}</td></tr>` : ""}
    </table>
    <div style="margin-top:24px;">
      <a href="${escapeHtml(ctaUrl || "#")}" style="display:inline-block;padding:14px 22px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:700;">
        Continue booking
      </a>
    </div>
  `;

  return getBaseEmailTemplate(content, "Complete your booking", {
    brandName: process.env.BOOKING_BRAND_NAME || "BookingGPT",
    headerTitle: process.env.BOOKING_BRAND_NAME || "BookingGPT",
    headerSubtitle: "Your selected stay is waiting",
    supportText: "Need help? partners@insiderbookings.com",
  });
};

export default {
  getBookingAbandonmentEmailTemplate,
};
