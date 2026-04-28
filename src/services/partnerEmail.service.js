import transporter from "./transporter.js";
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";
import { resolveMailFrom } from "../helpers/mailFrom.js";
import {
  PARTNER_EMAIL_SEQUENCE,
  getPartnerPlanByCode,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";

const PARTNERS_FROM_EMAIL =
  resolveMailFrom(process.env.PARTNERS_FROM_EMAIL || process.env.SMTP_FROM || null);
const PARTNERS_REPLY_TO_EMAIL =
  process.env.PARTNERS_REPLY_TO_EMAIL || "partners@insiderbookings.com";
const PARTNERS_INTERNAL_EMAIL =
  process.env.PARTNERS_INTERNAL_EMAIL ||
  process.env.PARTNERS_EMAIL ||
  "partners@insiderbookings.com";

const PARTNER_PLAN_CODES = Object.freeze(["verified", "preferred", "featured"]);
const PARTNER_CLAIM_SOURCE_LABELS = Object.freeze({
  verify: "Verification flow",
  search: "Manual hotel search claim",
});

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMoney = (amount, currency = "USD") => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${numeric} ${currency}`;
  }
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatCount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(numeric));
};

export const resolvePartnerDashboardUrl = (hotelId = null, extraParams = {}) => {
  const base =
    process.env.PARTNERS_CLIENT_URL ||
    process.env.CLIENT_URL ||
    "https://bookinggpt.app";
  const url = new URL("/partners/dashboard", base);
  if (hotelId) url.searchParams.set("hotelId", String(hotelId));
  Object.entries(extraParams || {}).forEach(([key, value]) => {
    if (value == null) return;
    const normalized = String(value).trim();
    if (!normalized) return;
    url.searchParams.set(key, normalized);
  });
  return url.toString();
};

const buildCta = (label, url) =>
  url
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(
        url,
      )}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700;">${escapeHtml(
        label,
      )}</a></p>`
    : "";

const chunkArray = (items = [], size = 2) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const normalizeStats = (stats = []) =>
  (Array.isArray(stats) ? stats : [])
    .filter((item) => item && item.label && item.value != null)
    .map((item) => ({
      label: String(item.label),
      value: String(item.value),
      note: String(item.note || "").trim(),
    }));

const buildStatsHtml = (stats = []) => {
  const items = normalizeStats(stats);
  if (!items.length) return "";
  const rows = chunkArray(items, 2);
  return `
    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:10px;margin:22px 0 4px;">
      ${rows
        .map(
          (row) => `
            <tr>
              ${row
                .map(
                  (item) => `
                    <td valign="top" width="${row.length === 1 ? "100%" : "50%"}" style="padding:16px 16px 14px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
                      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:8px;">${escapeHtml(
                        item.label,
                      )}</div>
                      <div style="font-size:24px;line-height:1.1;color:#0f172a;font-weight:800;margin-bottom:${
                        item.note ? "6px" : "0"
                      };">${escapeHtml(item.value)}</div>
                      ${
                        item.note
                          ? `<div style="font-size:13px;line-height:1.5;color:#475569;">${escapeHtml(
                              item.note,
                            )}</div>`
                          : ""
                      }
                    </td>
                  `,
                )
                .join("")}
              ${
                row.length === 1
                  ? '<td width="50%" style="padding:0;border:none;background:transparent;"></td>'
                  : ""
              }
            </tr>
          `,
        )
        .join("")}
    </table>
  `;
};

const buildPartnerEmailHtml = ({
  subject,
  preheader = "",
  eyebrow = "Partner program",
  intro,
  stats = [],
  bullets = [],
  outro = "",
  ctaLabel,
  ctaUrl,
}) => {
  const bulletHtml = bullets.length
    ? `<ul style="margin:18px 0;padding-left:18px;color:#334155;">${bullets
        .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : "";

  return getBaseEmailTemplate(
    `
      <p style="font-size:14px;color:#475569;margin:0 0 8px;">${escapeHtml(eyebrow)}</p>
      <h2 style="margin:0 0 16px;font-size:28px;line-height:1.15;color:#0f172a;">${escapeHtml(
        subject,
      )}</h2>
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(
        intro,
      )}</p>
      ${buildStatsHtml(stats)}
      ${bulletHtml}
      ${
        outro
          ? `<p style="margin:18px 0 0;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(
              outro,
            )}</p>`
          : ""
      }
      ${buildCta(ctaLabel, ctaUrl)}
    `,
    subject,
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT Partners",
      headerSubtitle: "Hotel growth, badges and monthly visibility plans",
      primaryColor: "#0f172a",
      accentColor: "#ef4444",
      backgroundColor: "#f8fafc",
      bodyBackground: "#ffffff",
      supportText: "Questions? Reply to this email and the BookingGPT team will help.",
      footerText: `Copyright ${new Date().getFullYear()} BookingGPT. All rights reserved.`,
      preheader,
      socialLinks: [],
    },
  );
};

export const buildPartnerLifecycleEmailText = ({
  subject,
  intro,
  stats = [],
  bullets = [],
  outro = "",
  ctaLabel,
  ctaUrl,
}) => {
  const lines = [subject, "", intro];
  const normalizedStats = normalizeStats(stats);
  if (normalizedStats.length) {
    lines.push("", "Highlights");
    normalizedStats.forEach((item) => {
      const noteSuffix = item.note ? ` (${item.note})` : "";
      lines.push(`- ${item.label}: ${item.value}${noteSuffix}`);
    });
  }
  if (bullets.length) {
    lines.push("", "Key points");
    bullets.forEach((item) => lines.push(`- ${item}`));
  }
  if (outro) {
    lines.push("", outro);
  }
  if (ctaLabel && ctaUrl) {
    lines.push("", `${ctaLabel}: ${ctaUrl}`);
  }
  return lines.join("\n");
};

const getPlanPricingStats = () =>
  PARTNER_PLAN_CODES.map((code) => {
    const plan = getPartnerPlanByCode(code);
    return {
      label: plan?.label || code,
      value: formatMoney(plan?.priceMonthly, plan?.currency) || "Custom",
      note: "per month",
    };
  });

const getWeeklyPerformanceStats = ({ claim, program }) => {
  const performance = claim?.partnerPerformance || {};
  const reachTotal = performance?.bookingGptReach?.total || 0;
  const last7Days = performance?.bookingGptReach?.last7Days || performance?.views?.last7Days || 0;
  const clicks = performance?.clicks?.total || 0;
  const trialDaysLeft = Number(program?.trialDaysLeft || 0);
  const trialEndLabel = formatDate(program?.trialEndsAt);

  return [
    {
      label: "BookingGPT Reach",
      value: formatCount(reachTotal),
      note: "tracked visibility in the current window",
    },
    {
      label: "Last 7 days",
      value: formatCount(last7Days),
      note: "recent visibility during the trial",
    },
    {
      label: "Clicks",
      value: formatCount(clicks),
      note: "travelers who clicked through so far",
    },
    {
      label: "Trial time left",
      value: `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`,
      note: trialEndLabel ? `trial ends ${trialEndLabel}` : "trial still active",
    },
  ];
};

const getPlanSelectionStats = ({ program, includeDaysLeft = false, badgeStatus = null }) => {
  const stats = [];
  if (includeDaysLeft) {
    const trialDaysLeft = Number(program?.trialDaysLeft || 0);
    stats.push({
      label: "Time left",
      value: `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`,
      note: program?.trialEndsAt ? `trial ends ${formatDate(program.trialEndsAt)}` : "trial still active",
    });
  } else if (badgeStatus) {
    stats.push({
      label: "Badge status",
      value: badgeStatus,
      note: program?.trialEndsAt ? `trial ended ${formatDate(program.trialEndsAt)}` : "",
    });
  } else if (program?.trialEndsAt) {
    stats.push({
      label: "Trial ends",
      value: formatDate(program.trialEndsAt),
      note: "partner pricing is now available",
    });
  }
  return [...stats, ...getPlanPricingStats()];
};

const getRequestedPlanLabel = (claim) =>
  getPartnerPlanByCode(claim?.pending_plan_code || claim?.current_plan_code)?.label ||
  claim?.pending_plan_code ||
  claim?.current_plan_code ||
  null;

const resolveWeeklyCopy = (emailKey) => {
  switch (emailKey) {
    case "day_7_report":
      return {
        weekLabel: "Week 1",
        intro: "Week 1 is complete and your Featured trial is still active on BookingGPT.",
        outro:
          "Open your dashboard to review the lifecycle timeline, visibility status and any listing updates for the hotel.",
      };
    case "day_14_report":
      return {
        weekLabel: "Week 2",
        intro: "Week 2 is complete and your Featured trial is still active on BookingGPT.",
        outro:
          "Open your dashboard to keep your listing details current and monitor how the trial is progressing.",
      };
    case "day_21_report":
    default:
      return {
        weekLabel: "Week 3",
        intro: "Week 3 is complete and your Featured trial is still active on BookingGPT.",
        outro:
          "Pricing unlocks on day 25, so this is a good time to review the dashboard and prepare for plan selection.",
      };
  }
};

export const resolvePartnerLifecycleTemplate = ({
  emailKey,
  claim,
  hotel,
  now = new Date(),
} = {}) => {
  const program = resolvePartnerProgramFromClaim(claim, now);
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id);
  const subscriptionDashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id, {
    section: "subscription",
  });
  const trialEndLabel = formatDate(program?.trialEndsAt);
  const trialDaysLeft = Number(program?.trialDaysLeft || 0);
  const requestedPlan = getRequestedPlanLabel(claim);

  switch (emailKey) {
    case "day_1_welcome":
      return {
        subject: `Your Featured badge is live for ${hotelName}`,
        preheader: `${hotelName} is now live with the Featured badge and a 30-day BookingGPT trial.`,
        intro: `Welcome to BookingGPT Partners. ${hotelName} is now live with the Featured badge and a 30-day trial already in motion.`,
        stats: [
          {
            label: "Badge",
            value: program?.badgeLabel || "Featured",
            note: "active from day one",
          },
          {
            label: "Trial status",
            value: program?.statusLabel || "Trial active",
            note: trialEndLabel ? `scheduled to end ${trialEndLabel}` : "no card required now",
          },
        ],
        bullets: [
          "Your partner dashboard is ready right now.",
          "No card is required to explore the dashboard or complete setup.",
          "We will send weekly performance updates during the trial and reveal pricing on day 25.",
        ],
        outro:
          "Use the dashboard to review your listing, understand the lifecycle timeline and prepare for plan selection later in the trial.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_7_report":
    case "day_14_report":
    case "day_21_report": {
      const weeklyCopy = resolveWeeklyCopy(emailKey);
      const favorites = claim?.partnerPerformance?.favorites?.total || 0;
      return {
        subject: `${hotelName}: your ${weeklyCopy.weekLabel.toLowerCase()} BookingGPT trial report`,
        preheader: `${weeklyCopy.weekLabel} performance update for ${hotelName}, with live trial status and dashboard access.`,
        intro: `${weeklyCopy.intro} Here is the latest visibility snapshot for ${hotelName}.`,
        stats: getWeeklyPerformanceStats({ claim, program }),
        bullets: [
          `Featured badge status: active.`,
          `Saved to favorites so far: ${formatCount(favorites)}.`,
          trialEndLabel
            ? `Trial time remaining: ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}, until ${trialEndLabel}.`
            : `Trial time remaining: ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}.`,
        ],
        outro: weeklyCopy.outro,
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    }
    case "day_15_midpoint":
      return {
        subject: `${hotelName}: you are halfway through your trial`,
        preheader: `${hotelName} has reached the midpoint of the BookingGPT Featured trial.`,
        intro: `You are halfway through the 30-day BookingGPT Featured trial for ${hotelName}.`,
        stats: getWeeklyPerformanceStats({ claim, program }),
        bullets: [
          "Your hotel remains visible with the Featured badge.",
          "No action is required yet if you are still reviewing the setup and visibility.",
          "Plan pricing stays hidden until day 25, so you can keep focusing on the listing before the subscription decision.",
        ],
        outro:
          "Use the dashboard to review performance, keep the listing up to date and prepare for plan selection later in the trial.",
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_25_choose_plan":
      return {
        subject: `${hotelName}: 5 days left to keep your badge`,
        preheader: `Partner pricing is now visible. Choose a plan for ${hotelName} before the trial ends.`,
        intro: `Your BookingGPT trial is entering its final stretch. Choose a plan now to keep partner badge visibility active when the trial ends${trialEndLabel ? ` on ${trialEndLabel}` : ""}.`,
        stats: getPlanSelectionStats({ program }),
        bullets: [
          "Verified keeps an active partner badge on the listing.",
          "Preferred adds stronger visibility and enhanced partner lifecycle features.",
          "Featured keeps the strongest placement and the full premium partner feature set.",
          "You can activate instantly by card or request an invoice from the dashboard.",
        ],
        outro:
          "If no plan is selected, the badge is removed automatically on day 30 and the hotel continues without premium partner visibility.",
        ctaLabel: "Choose a plan",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_27_urgent":
      return {
        subject: `${hotelName}: 3 days left before badge removal`,
        preheader: `${hotelName} has 3 days left before the BookingGPT partner badge is removed.`,
        intro: `There are 3 days left before the partner badge is removed from ${hotelName}.`,
        stats: getPlanSelectionStats({ program, includeDaysLeft: true }),
        bullets: [
          "Card activation keeps the badge live immediately.",
          "Invoice requests stay pending until payment is confirmed.",
          "Manual follow-up remains scheduled, but the fastest way to keep visibility is activating the plan from the dashboard today.",
        ],
        outro:
          "If you still want partner visibility on BookingGPT, now is the right time to choose the plan that fits this property.",
        ctaLabel: "Keep my badge",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_28_final_warning":
      return {
        subject: `${hotelName}: tomorrow your badge disappears`,
        preheader: `Final reminder: choose a partner plan for ${hotelName} before tomorrow's badge removal.`,
        intro: `This is the final day before the partner badge is removed from ${hotelName}. If you want to keep premium visibility active, choose a plan now.`,
        stats: getPlanSelectionStats({ program, includeDaysLeft: true }),
        bullets: [
          "Verified, Preferred and Featured are all available from the dashboard.",
          "Card payments activate immediately after checkout completes.",
          "A second manual call attempt is still scheduled, but the dashboard is the fastest way to secure the badge.",
        ],
        outro:
          "Once the trial expires, the hotel remains listed on BookingGPT but without the premium partner badge.",
        ctaLabel: "Restore before removal",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_30_removed":
      return {
        subject: `${hotelName}: your badge has been removed`,
        preheader: `${hotelName} is still listed on BookingGPT, but the partner badge has now been removed.`,
        intro: `The 30-day trial has ended and the partner badge has now been removed from ${hotelName}.`,
        stats: getPlanSelectionStats({ program, badgeStatus: "Removed" }),
        bullets: [
          "Your hotel is still listed on BookingGPT.",
          "The premium partner badge and boosted placement return as soon as a plan is activated.",
          "You can restore visibility with Verified, Preferred or Featured directly from the dashboard.",
        ],
        outro:
          "If you want to keep discovery momentum and premium partner treatment, restore the badge now.",
        ctaLabel: "Restore my badge",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_32_restore":
      return {
        subject: `${hotelName}: restore your BookingGPT badge`,
        preheader: `Your hotel is still on BookingGPT. Restore the badge when you are ready.`,
        intro: `${hotelName} is still listed on BookingGPT, but the partner badge remains inactive.`,
        stats: getPlanSelectionStats({ program, badgeStatus: "Inactive" }),
        bullets: [
          "Verified reactivates the entry partner badge.",
          "Preferred restores stronger visibility and enhanced lifecycle benefits.",
          "Featured restores the strongest placement and the full premium feature set.",
        ],
        outro:
          "Open the dashboard when you are ready to reactivate the plan that fits this property.",
        ctaLabel: "Restore my badge",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_37_last_message":
      return {
        subject: `${hotelName}: final message about your badge`,
        preheader: `Final BookingGPT follow-up for ${hotelName} before automated reminders stop.`,
        intro: `This is the final automated follow-up for ${hotelName} in the BookingGPT launch sequence.`,
        stats: getPlanSelectionStats({ program, badgeStatus: "Inactive" }),
        bullets: [
          "Your badge is ready to return as soon as you pick a plan.",
          "Verified, Preferred and Featured remain available in the dashboard.",
          "After this message, the automatic follow-up sequence stops.",
        ],
        outro:
          "If this hotel still wants premium partner visibility on BookingGPT, the next step is simply selecting the right plan in the dashboard.",
        ctaLabel: "Choose a plan",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "plan_confirmation":
      return {
        subject: `${hotelName}: your ${program?.planLabel || "BookingGPT"} plan is active`,
        preheader: `${hotelName} is active on the ${program?.planLabel || "BookingGPT"} plan.`,
        intro: `Your BookingGPT partner plan is now active for ${hotelName}${program?.badgeLabel ? ` and the ${program.badgeLabel} badge is live again` : ""}.`,
        stats: [
          {
            label: "Plan",
            value: program?.planLabel || "Active",
            note: program?.badgeLabel ? `${program.badgeLabel} badge` : "partner plan active",
          },
          {
            label: "Monthly billing",
            value: formatMoney(program?.priceMonthly, program?.currency) || "Custom",
            note: "per month",
          },
          {
            label: "Next billing date",
            value: formatDate(program?.nextBillingAt) || "TBD",
            note: "based on the current subscription",
          },
          {
            label: "Payment method",
            value: claim?.billing_method ? String(claim.billing_method).toUpperCase() : "CARD",
            note: "managed in the dashboard",
          },
        ],
        bullets: [
          "Your listing now reflects the active partner plan.",
          "Automated trial follow-ups stop while the subscription remains active.",
          "You can manage billing details, plan changes and lifecycle status from the dashboard at any time.",
        ],
        outro:
          "Thank you for continuing with BookingGPT Partners. We are ready if you need help optimizing the listing or billing setup.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "invoice_requested":
      return {
        subject: `${hotelName}: we received your invoice request`,
        preheader: `Your BookingGPT invoice request for ${hotelName} is now pending review.`,
        intro: `We received your invoice request for ${hotelName} and the BookingGPT team has been notified.`,
        stats: [
          {
            label: "Requested plan",
            value: requestedPlan || "Pending",
            note: "the plan selected in the dashboard",
          },
          {
            label: "Billing method",
            value: "Invoice",
            note: "pending confirmation",
          },
          {
            label: "Requested on",
            value: formatDate(claim?.invoice_requested_at) || "Today",
            note: "submission timestamp",
          },
          {
            label: "Billing email",
            value: claim?.contact_email || "Not provided",
            note: "where the invoice follow-up is coordinated",
          },
        ],
        bullets: [
          "The badge does not reactivate until invoice payment is confirmed.",
          "The BookingGPT team will continue the billing follow-up from the details on file.",
          "You can return to the dashboard anytime to review plan details or your billing request.",
        ],
        outro:
          "Reply to this email if you need to correct the billing contact or provide extra invoicing details before the review is completed.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    default: {
      const fallback = PARTNER_EMAIL_SEQUENCE.find((entry) => entry.key === emailKey);
      return {
        subject: fallback?.subject || "BookingGPT Partners update",
        preheader: fallback?.preview || "Your BookingGPT partner status was updated.",
        intro: fallback?.preview || "Your BookingGPT partner status was updated.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    }
  }
};

export const sendPartnerLifecycleEmail = async ({ claim, hotel, emailKey }) => {
  const toEmail = String(claim?.contact_email || "").trim().toLowerCase();
  if (!toEmail) return { skipped: true, reason: "missing-contact-email" };

  const template = resolvePartnerLifecycleTemplate({ emailKey, claim, hotel });
  const html = buildPartnerEmailHtml(template);
  const text = buildPartnerLifecycleEmailText(template);
  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: toEmail,
    subject: template.subject,
    html,
    text,
  });
  return { skipped: false };
};

export const sendPartnerInternalManualReviewAlert = async ({ claim, hotel, user, review }) => {
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id);
  const rows = [
    ["Hotel", hotelName],
    ["Hotel ID", claim?.hotel_id],
    ["Claim ID", claim?.id],
    ["Source", PARTNER_CLAIM_SOURCE_LABELS[String(review?.source || "").trim().toLowerCase()] || "-"],
    ["Contact name", claim?.contact_name || user?.name || "-"],
    ["Contact email", claim?.contact_email || user?.email || "-"],
    ["Contact phone", claim?.contact_phone || user?.phone || "-"],
    ["User ID", user?.id || claim?.user_id || "-"],
    ["Dashboard status", "Blocked until manual enable"],
  ];
  const html = getBaseEmailTemplate(
    `
      <h2 style="margin:0 0 16px;">Partner claim waiting for manual review</h2>
      <p style="margin:0 0 18px;color:#475569;">A hotel was claimed from the public partners flow and the dashboard was left blocked until manual approval.</p>
      <table style="width:100%;border-collapse:collapse;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:6px 0;color:#64748b;width:180px;">${escapeHtml(
                label,
              )}</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}
      </table>
      ${buildCta("Open dashboard", dashboardUrl)}
    `,
    "Partner manual review needed",
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT Partners",
      headerSubtitle: "Manual review requested",
      primaryColor: "#0f172a",
      accentColor: "#f97316",
      preheader: `Manual review requested for ${hotelName}.`,
      socialLinks: [],
    },
  );
  const text = [
    "Partner claim waiting for manual review",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Open dashboard: ${dashboardUrl}`,
  ].join("\n");
  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: PARTNERS_INTERNAL_EMAIL,
    subject: `Manual review: ${hotelName}`,
    html,
    text,
  });
};

export const sendPartnerInternalInvoiceAlert = async ({ claim, hotel, billingDetails }) => {
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id);
  const requestedPlan =
    getPartnerPlanByCode(claim?.pending_plan_code || claim?.current_plan_code)?.label ||
    claim?.pending_plan_code ||
    claim?.current_plan_code ||
    "-";
  const rows = [
    ["Hotel", hotelName],
    ["Hotel ID", claim?.hotel_id],
    ["Claim ID", claim?.id],
    ["Requested plan", requestedPlan],
    ["Billing name", billingDetails?.billingName || "-"],
    ["Billing email", billingDetails?.billingEmail || claim?.contact_email || "-"],
    ["Billing address", billingDetails?.billingAddress || "-"],
  ];
  const html = getBaseEmailTemplate(
    `
      <h2 style="margin:0 0 16px;">New partner invoice request</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:6px 0;color:#64748b;width:160px;">${escapeHtml(
                label,
              )}</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}
      </table>
      ${buildCta("Open dashboard", dashboardUrl)}
    `,
    "Partner invoice request",
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT Partners",
      headerSubtitle: "Invoice request received",
      primaryColor: "#0f172a",
      accentColor: "#ef4444",
      preheader: `New invoice request received for ${hotelName}.`,
      socialLinks: [],
    },
  );
  const text = [
    "New partner invoice request",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Open dashboard: ${dashboardUrl}`,
  ].join("\n");
  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: PARTNERS_INTERNAL_EMAIL,
    subject: `Invoice request: ${hotelName}`,
    html,
    text,
  });
};
