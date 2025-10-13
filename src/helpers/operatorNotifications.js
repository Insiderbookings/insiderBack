import models from "../models/index.js";
import { sendMail } from "./mailer.js";
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";

const PANEL_FALLBACK_URL = "https://app.insiderbookings.com/operator";
const TRANSFER_TIMEOUT_HOURS = 12;
const DATE_TIME_FORMATTER =
  typeof Intl !== "undefined" && Intl.DateTimeFormat
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" })
    : null;

function resolveOperatorPanelUrl() {
  const envUrl = process.env.OPERATOR_PANEL_URL || process.env.CLIENT_URL;
  if (!envUrl) return PANEL_FALLBACK_URL;
  const trimmed = envUrl.replace(/\/+$/g, "");
  if (trimmed.toLowerCase().endsWith("/operator")) return trimmed;
  return `${trimmed}/operator`;
}

function firstName(name) {
  if (!name) return "";
  const parts = String(name).trim().split(/\s+/);
  return parts[0] || "";
}

function composeDetailList(pairs) {
  const valid = pairs.filter((pair) => pair && pair.value);
  if (!valid.length) {
    return { html: "", text: [] };
  }
  const itemsHtml = valid
    .map((pair) => `<li style="margin-bottom:8px;color:#334155;font-size:15px;"><strong>${pair.label}:</strong> ${pair.value}</li>`)
    .join("");
  const html = `<ul style="margin:16px 0;padding-left:22px;">${itemsHtml}</ul>`;
  const text = valid.map((pair) => `${pair.label}: ${pair.value}`);
  return { html, text };
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  if (DATE_TIME_FORMATTER) {
    try {
      return DATE_TIME_FORMATTER.format(date);
    } catch {
      /* ignore formatter failure */
    }
  }
  return date.toISOString();
}

function resolveTransferDeadline(transfer) {
  if (!transfer) return null;
  const raw =
    transfer.expiresAt ||
    transfer.expires_at ||
    transfer.metadata?.expiresAt ||
    transfer.timeoutDeadline;
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const createdRaw = transfer.createdAt || transfer.created_at;
  if (createdRaw) {
    const created = new Date(createdRaw);
    if (!Number.isNaN(created.getTime())) {
      return new Date(created.getTime() + TRANSFER_TIMEOUT_HOURS * 60 * 60 * 1000);
    }
  }
  return null;
}

function formatExpiration(expMonth, expYear) {
  const monthNum = Number(expMonth);
  const yearNum = Number(expYear);
  if (!Number.isFinite(monthNum) || !Number.isFinite(yearNum)) return null;
  const clampedMonth = Math.max(1, Math.min(12, Math.trunc(monthNum)));
  const paddedMonth = String(clampedMonth).padStart(2, "0");
  return `${paddedMonth}/${yearNum}`;
}

function composeCardDetails(cards) {
  if (!Array.isArray(cards) || !cards.length) {
    return { html: "", text: [] };
  }
  const entries = cards
    .map((card, index) => {
      const parts = [];
      if (card?.amount != null) parts.push(`Amount: ${card.amount}`);
      if (card?.currency) parts.push(`Currency: ${card.currency}`);
      const exp = formatExpiration(card?.exp_month, card?.exp_year);
      if (exp) parts.push(`Expires: ${exp}`);
      if (!parts.length) return null;
      return {
        html: `<li style="margin-bottom:8px;color:#334155;font-size:15px;"><strong>Card ${index + 1}:</strong> ${parts.join(' &middot; ')}</li>`,
        text: `Card ${index + 1}: ${parts.join(', ')}`,
      };
    })
    .filter(Boolean);
  if (!entries.length) {
    return { html: "", text: [] };
  }
  const html = `<ul style="margin:16px 0;padding-left:22px;">${entries.map((entry) => entry.html).join("")}</ul>`;
  const text = entries.map((entry) => entry.text);
  return { html, text };
}

async function fetchTenantOperators(tenantId) {
  if (!tenantId) return [];
  try {
    const links = await models.WcUserTenant.findAll({
      where: { tenant_id: tenantId },
      attributes: ["user_id"],
    });
    const ids = Array.from(new Set(links.map((row) => row?.user_id).filter(Boolean)));
    if (!ids.length) return [];
    const users = await models.User.findAll({
      where: {
        id: ids,
        role: 5,
        is_active: true,
      },
      attributes: ["id", "email", "name"],
    });
    return users
      .map((u) => (typeof u.toJSON === "function" ? u.toJSON() : u))
      .filter((u) => u?.email);
  } catch (err) {
    console.warn(`operatorNotifications: failed to fetch operators for tenant ${tenantId}: ${err?.message || err}`);
    return [];
  }
}

function buildTransferEmail({ user, transfer, panelUrl }) {
  const name = firstName(user?.name) || "there";
  const amountValue = transfer?.amount != null
    ? `${transfer.amount}${transfer?.currency ? ` ${transfer.currency}` : ""}`
    : "Not specified";
  const deadlineDate = resolveTransferDeadline(transfer);
  const deadlineLabel = deadlineDate ? formatDateTime(deadlineDate) : null;
  const details = composeDetailList([
    { label: "Amount", value: amountValue },
    { label: "Booking code", value: transfer?.booking_code ? String(transfer.booking_code) : null },
    { label: "Guest", value: transfer?.guest_name ? String(transfer.guest_name) : null },
    deadlineLabel ? { label: "Complete before", value: deadlineLabel } : null,
  ]);

  const content = `
    <p style="margin:0 0 16px 0;color:#0f172a;font-size:16px;">Hi ${name},</p>
    <p style="margin:0 0 16px 0;color:#475569;font-size:15px;">A new transfer is waiting for you in the Insider Bookings operator panel.</p>
    ${details.html}
    ${
      deadlineLabel
        ? `<p style="margin:0 0 16px 0;color:#b91c1c;font-size:14px;"><strong>Reminder:</strong> complete the transfer within ${TRANSFER_TIMEOUT_HOURS} hours. Deadline: ${deadlineLabel}.</p>`
        : ""
    }
    <p style="margin:0 0 24px 0;color:#475569;font-size:15px;">Sign in to review the information and continue the process.</p>
    <p style="margin:0;"><a href="${panelUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;">Open Operator Panel</a></p>
  `;
  const html = getBaseEmailTemplate(content, "New operator transfer");
  const textLines = [
    `Hi ${name},`,
    "",
    "A new transfer is waiting for you in the Insider Bookings operator panel.",
    ...details.text,
  ];
  if (deadlineLabel) {
    textLines.push("", `Reminder: complete the transfer within ${TRANSFER_TIMEOUT_HOURS} hours (deadline: ${deadlineLabel}).`);
  }
  textLines.push("", `Open the operator panel: ${panelUrl}`);
  const text = textLines.join("\n");
  return {
    subject: "You have a new transfer",
    html,
    text,
  };
}

function buildCardEmail({ user, cards, panelUrl }) {
  const name = firstName(user?.name) || "there";
  const count = Array.isArray(cards) ? cards.length : 0;
  const plural = count === 1 ? "virtual card" : "virtual cards";
  const { html: cardListHtml, text: cardListText } = composeCardDetails(cards);
  const content = `
    <p style="margin:0 0 16px 0;color:#0f172a;font-size:16px;">Hi ${name},</p>
    <p style="margin:0 0 16px 0;color:#475569;font-size:15px;">We created ${count} new ${plural} for your tenant.</p>
    ${cardListHtml}
    <p style="margin:0 0 24px 0;color:#475569;font-size:15px;">Sign in to claim.</p>
    <p style="margin:0;"><a href="${panelUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px;">Open Operator Panel</a></p>
  `;
  const html = getBaseEmailTemplate(content, "New virtual cards");
  const text = [
    `Hi ${name},`,
    "",
    `We created ${count} new ${plural} for your tenant.`,
    ...cardListText,
    "",
    `Open the operator panel: ${panelUrl}`,
  ].join("\n");
  return {
    subject: count === 1 ? "You have a new virtual card" : "You have new virtual cards",
    html,
    text,
  };
}

async function sendToOperators(tenantId, builder) {
  const users = await fetchTenantOperators(tenantId);
  if (!users.length) return { sent: 0, users: [] };
  const panelUrl = resolveOperatorPanelUrl();
  const deliveries = await Promise.allSettled(
    users.map(async (user) => {
      try {
        const payload = builder({ user, panelUrl });
        if (!payload?.subject || !payload?.html || !payload?.text) return;
        await sendMail({
          to: user.email,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
        });
      } catch (err) {
        console.warn(`operatorNotifications: failed sending email to ${user.email}: ${err?.message || err}`);
      }
    })
  );
  const sent = deliveries.filter((d) => d.status === "fulfilled").length;
  return { sent, users };
}

export async function notifyOperatorsNewTransfer({ tenantId, transfer }) {
  if (!tenantId || !transfer) return { sent: 0 };
  return sendToOperators(tenantId, ({ user, panelUrl }) =>
    buildTransferEmail({ user, transfer, panelUrl })
  );
}

export async function notifyOperatorsNewCards({ tenantId, cards }) {
  if (!tenantId || !Array.isArray(cards) || !cards.length) return { sent: 0 };
  const safeCards = cards.map((card) => ({
    amount: card?.amount ?? null,
    currency: card?.currency ?? null,
    exp_month: card?.exp_month ?? null,
    exp_year: card?.exp_year ?? null,
  }));
  return sendToOperators(tenantId, ({ user, panelUrl }) =>
    buildCardEmail({ user, cards: safeCards, panelUrl })
  );
}
