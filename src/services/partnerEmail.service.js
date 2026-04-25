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

const resolveDashboardUrl = (hotelId = null) => {
  const base =
    process.env.PARTNERS_CLIENT_URL ||
    process.env.CLIENT_URL ||
    "https://bookinggpt.app";
  const url = new URL("/partners", base);
  if (hotelId) url.searchParams.set("hotelId", String(hotelId));
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

const buildPartnerEmailBody = ({ subject, intro, bullets = [], outro = "", ctaLabel, ctaUrl }) => {
  const bulletHtml = bullets.length
    ? `<ul style="margin:18px 0;padding-left:18px;color:#334155;">${bullets
        .map((item) => `<li style="margin:0 0 8px;">${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    : "";
  return getBaseEmailTemplate(
    `
      <p style="font-size:14px;color:#475569;margin:0 0 8px;">Partner program</p>
      <h2 style="margin:0 0 16px;font-size:28px;line-height:1.15;color:#0f172a;">${escapeHtml(
        subject,
      )}</h2>
      <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(
        intro,
      )}</p>
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
    },
  );
};

const resolveSequenceTemplate = ({ emailKey, claim, hotel }) => {
  const program = resolvePartnerProgramFromClaim(claim);
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolveDashboardUrl(claim?.hotel_id);
  switch (emailKey) {
    case "day_1_welcome":
      return {
        subject: `Your Featured badge is live for ${hotelName}`,
        intro: `Welcome to BookingGPT Partners. Your hotel is now showing with the Featured badge during your 30-day trial.`,
        bullets: [
          "Your dashboard is ready.",
          "Your trial starts immediately with no card required.",
          "We will send weekly performance updates during the trial.",
        ],
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_7_report":
    case "day_14_report":
    case "day_21_report":
      return {
        subject: `${hotelName}: your weekly BookingGPT trial report`,
        intro: `Your hotel is still live with the Featured badge. This report email is part of the launch sequence described in the partners spec.`,
        bullets: [
          "BookingGPT Reach and clicks summary placeholder is ready in the email flow.",
          "The dashboard route is included so the hotel can review status.",
          "The live analytics panel can be expanded later without changing the sequence.",
        ],
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_15_midpoint":
      return {
        subject: `${hotelName}: you are halfway through your trial`,
        intro: "You are halfway through your BookingGPT Featured trial.",
        bullets: [
          "Your hotel remains visible with the Featured badge.",
          "No action is needed yet.",
          "Plan pricing stays hidden until day 25.",
        ],
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_25_choose_plan":
      return {
        subject: `${hotelName}: 5 days left to keep your badge`,
        intro: "Your trial ends in 5 days. Choose a plan now to keep a badge on your hotel card.",
        bullets: [
          "Plans are now visible in your dashboard, starting at $49 per month.",
          "You can pay by card or request an invoice.",
          "If you do nothing, the badge is removed automatically at day 30.",
        ],
        ctaLabel: "Choose a plan",
        ctaUrl: dashboardUrl,
      };
    case "day_27_urgent":
      return {
        subject: `${hotelName}: 3 days left before badge removal`,
        intro: "Your badge disappears soon unless you choose a plan.",
        bullets: [
          "Card payment activates the badge instantly.",
          "Invoice requests stay pending until payment is confirmed.",
          "A manual follow-up call is also scheduled.",
        ],
        ctaLabel: "Keep my badge",
        ctaUrl: dashboardUrl,
      };
    case "day_28_final_warning":
      return {
        subject: `${hotelName}: tomorrow your badge disappears`,
        intro: "This is the final warning before badge removal.",
        bullets: [
          "Choose Verified, Preferred or Featured today.",
          "Card payments activate immediately.",
          "A second manual call attempt is scheduled.",
        ],
        ctaLabel: "Restore before removal",
        ctaUrl: dashboardUrl,
      };
    case "day_30_removed":
      return {
        subject: `${hotelName}: your badge has been removed`,
        intro: "Your trial ended and your badge has been removed automatically.",
        bullets: [
          "Your hotel stays on BookingGPT, but without a badge.",
          "You can restore visibility by selecting a plan.",
          "A third manual follow-up call is scheduled.",
        ],
        ctaLabel: "Restore my badge",
        ctaUrl: dashboardUrl,
      };
    case "day_32_restore":
      return {
        subject: `${hotelName}: restore your BookingGPT badge`,
        intro: "Your hotel is still listed without a badge.",
        bullets: [
          "Verified restores your Verified badge.",
          "Preferred restores your Preferred badge.",
          "Featured restores your Featured badge.",
        ],
        ctaLabel: "Restore my badge",
        ctaUrl: dashboardUrl,
      };
    case "day_37_last_message":
      return {
        subject: `${hotelName}: final message about your badge`,
        intro: "This is the final follow-up in the launch sequence.",
        bullets: [
          "Your badge is waiting once you pick a plan.",
          "After this message, the automatic follow-up stops.",
        ],
        ctaLabel: "Choose a plan",
        ctaUrl: dashboardUrl,
      };
    case "plan_confirmation":
      return {
        subject: `${hotelName}: your ${program?.planLabel || "BookingGPT"} plan is active`,
        intro: `Your badge is active again${program?.badgeLabel ? ` as ${program.badgeLabel}` : ""}.`,
        bullets: [
          program?.planLabel ? `Plan: ${program.planLabel}` : null,
          program?.priceMonthly ? `Monthly billing: ${formatMoney(program.priceMonthly, program.currency)}` : null,
          program?.nextBillingAt ? `Next billing date: ${new Date(program.nextBillingAt).toLocaleDateString("en-US")}` : null,
        ].filter(Boolean),
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "invoice_requested":
      return {
        subject: `${hotelName}: we received your invoice request`,
        intro: "Your invoice request is now pending review.",
        bullets: [
          "The badge does not reactivate until payment is confirmed.",
          "The BookingGPT team has been notified.",
          "You can still return to your dashboard to review plan details.",
        ],
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    default: {
      const fallback = PARTNER_EMAIL_SEQUENCE.find((entry) => entry.key === emailKey);
      return {
        subject: fallback?.subject || "BookingGPT Partners update",
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

  const template = resolveSequenceTemplate({ emailKey, claim, hotel });
  const html = buildPartnerEmailBody(template);
  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: toEmail,
    subject: template.subject,
    html,
  });
  return { skipped: false };
};

export const sendPartnerInternalInvoiceAlert = async ({ claim, hotel, billingDetails }) => {
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolveDashboardUrl(claim?.hotel_id);
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
    },
  );
  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: PARTNERS_INTERNAL_EMAIL,
    subject: `Invoice request: ${hotelName}`,
    html,
  });
};
