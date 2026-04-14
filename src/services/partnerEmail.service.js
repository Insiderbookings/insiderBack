import transporter from "./transporter.js";
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";
import {
  PARTNER_EMAIL_SEQUENCE,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";

const PARTNERS_FROM_EMAIL =
  process.env.PARTNERS_FROM_EMAIL ||
  process.env.SMTP_FROM ||
  "partners@insiderbookings.com";
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

const resolveDashboardUrl = (hotelId = null, extraParams = null) => {
  const base =
    process.env.PARTNERS_CLIENT_URL ||
    process.env.CLIENT_URL ||
    "https://bookinggpt.app";
  const url = new URL("/partners", base);
  if (hotelId) url.searchParams.set("hotelId", String(hotelId));
  if (extraParams && typeof extraParams === "object") {
    Object.entries(extraParams).forEach(([key, value]) => {
      if (value == null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
};

const resolvePublicSearchUrl = ({ city = null, country = null } = {}) => {
  const base = process.env.CLIENT_URL || process.env.PARTNERS_CLIENT_URL || "https://bookinggpt.app";
  const url = new URL("/search", base);
  if (city) url.searchParams.set("where", String(city));
  if (country) url.searchParams.set("country", String(country));
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
  const dashboardUrl = resolveDashboardUrl(claim?.hotel_id, {
    partnerSurface: "email",
    partnerEmailKey: emailKey,
  });
  switch (emailKey) {
    case "day_1_welcome":
      return {
        subject: `Your Featured badge is live for ${hotelName}`,
        intro: `Welcome to BookingGPT Partners. Your hotel is now showing with the Featured badge during your 30-day trial.`,
        bullets: [
          "Your dashboard is ready.",
          "Your trial starts immediately with no card required.",
          "We will send weekly BookingGPT Reach and click updates during the trial.",
        ],
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_7_report":
    case "day_14_report":
    case "day_21_report":
      return {
        subject: `${hotelName}: your weekly BookingGPT trial report`,
        intro: `Your hotel is still live with the Featured badge. This report email is part of the trial sequence and highlights BookingGPT Reach and clicks.`,
        bullets: [
          "BookingGPT Reach combines in-app visibility with manual social additions.",
          "Clicks remain part of the weekly performance update.",
          "The dashboard route is included so the hotel can review status and plan timing.",
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
          "Verified restores the Verified badge.",
          "Preferred restores the Preferred badge.",
          "Featured restores the Featured badge.",
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
  const rows = [
    ["Hotel", hotelName],
    ["Hotel ID", claim?.hotel_id],
    ["Claim ID", claim?.id],
    ["Requested plan", claim?.pending_plan_code || claim?.current_plan_code || "-"],
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

export const sendPartnerHotelInquiryEmail = async ({ claim, hotel, partnerProfile, traveler }) => {
  const toEmail = String(
    partnerProfile?.inquiryEmail || claim?.contact_email || "",
  )
    .trim()
    .toLowerCase();
  if (!toEmail) {
    const error = new Error("Inquiry destination email is not configured");
    error.status = 500;
    throw error;
  }

  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolveDashboardUrl(claim?.hotel_id);
  const rows = [
    ["Traveler", traveler?.name || "-"],
    ["Email", traveler?.email || "-"],
    ["Phone", traveler?.phone || "-"],
    ["Check-in", traveler?.checkIn || "-"],
    ["Check-out", traveler?.checkOut || "-"],
    ["Source", traveler?.sourceSurface || "detail"],
  ];

  const html = getBaseEmailTemplate(
    `
      <p style="font-size:14px;color:#475569;margin:0 0 8px;">Booking inquiry</p>
      <h2 style="margin:0 0 16px;font-size:28px;line-height:1.15;color:#0f172a;">New traveler inquiry for ${escapeHtml(
        hotelName,
      )}</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:6px 0;color:#64748b;width:140px;">${escapeHtml(
                label,
              )}</td><td style="padding:6px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>`,
          )
          .join("")}
      </table>
      <div style="margin-top:20px;padding:16px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
        <p style="margin:0 0 10px;color:#64748b;font-size:13px;font-weight:700;">Traveler message</p>
        <p style="margin:0;color:#0f172a;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(
          traveler?.message || "",
        )}</p>
      </div>
      ${buildCta("Open partner dashboard", dashboardUrl)}
    `,
    `Booking inquiry for ${hotelName}`,
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT Partners",
      headerSubtitle: "Traveler inquiry received",
      primaryColor: "#0f172a",
      accentColor: "#ef4444",
      backgroundColor: "#f8fafc",
      bodyBackground: "#ffffff",
    },
  );

  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: traveler?.email || PARTNERS_REPLY_TO_EMAIL,
    to: toEmail,
    cc: PARTNERS_INTERNAL_EMAIL || undefined,
    subject: `Booking inquiry: ${hotelName}`,
    html,
  });
};

export const sendPartnerDestinationSpotlightEmail = async ({
  city,
  country = null,
  recipients,
  hotels = [],
  subject = null,
  intro = null,
  triggeredByUser = null,
}) => {
  const safeCity = String(city || "").trim();
  const safeCountry = String(country || "").trim();
  const normalizedRecipients = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
  if (!safeCity || !normalizedRecipients.length || !hotels.length) {
    const error = new Error("Destination email campaign is missing city, recipients or hotels");
    error.status = 400;
    throw error;
  }

  const locationLabel = [safeCity, safeCountry].filter(Boolean).join(", ");
  const campaignSubject = subject || `Where to stay in ${locationLabel} with BookingGPT`;
  const campaignIntro =
    intro ||
    `Here are a few hotel partners currently standing out in ${locationLabel}. These picks are surfaced from the BookingGPT partner program.`;
  const ctaUrl = resolvePublicSearchUrl({ city: safeCity, country: safeCountry || null });
  const cardsHtml = hotels
    .map((hotel) => {
      const badgeHex = hotel?.partnerProgram?.badgeColorHex || "#0f172a";
      const badgeLabel = hotel?.partnerProgram?.badgeLabel || "Partner";
      const responseTime = hotel?.partnerProfile?.responseTimeLabel || null;
      const specialOffer = hotel?.partnerProfile?.specialOfferText || null;
      return `
        <div style="padding:18px;border:1px solid #e2e8f0;border-radius:18px;background:#ffffff;margin:0 0 14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;">
            <strong style="font-size:18px;color:#0f172a;">${escapeHtml(hotel?.name || "Hotel partner")}</strong>
            <span style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:${escapeHtml(
              badgeHex,
            )};color:#ffffff;font-size:12px;font-weight:700;">${escapeHtml(badgeLabel)}</span>
          </div>
          <p style="margin:0 0 10px;color:#64748b;font-size:14px;">${escapeHtml(
            [hotel?.city, hotel?.country].filter(Boolean).join(", ") || locationLabel,
          )}</p>
          ${
            responseTime
              ? `<p style="margin:0 0 8px;color:#0f172a;font-size:14px;"><strong>Response time:</strong> ${escapeHtml(
                  responseTime,
                )}</p>`
              : ""
          }
          ${
            specialOffer
              ? `<p style="margin:0;color:#be123c;font-size:14px;font-weight:700;">${escapeHtml(
                  specialOffer,
                )}</p>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  const html = getBaseEmailTemplate(
    `
      <p style="font-size:14px;color:#475569;margin:0 0 8px;">Destination spotlight</p>
      <h2 style="margin:0 0 16px;font-size:28px;line-height:1.15;color:#0f172a;">${escapeHtml(
        campaignSubject,
      )}</h2>
      <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.7;">${escapeHtml(
        campaignIntro,
      )}</p>
      <div>${cardsHtml}</div>
      ${buildCta(`Explore ${safeCity}`, ctaUrl)}
      ${
        triggeredByUser?.email
          ? `<p style="margin:22px 0 0;color:#94a3b8;font-size:12px;">Generated by ${escapeHtml(
              triggeredByUser.email,
            )} from BookingGPT Partners admin.</p>`
          : ""
      }
    `,
    campaignSubject,
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT",
      headerSubtitle: "Destination partner spotlight",
      primaryColor: "#0f172a",
      accentColor: "#ef4444",
      backgroundColor: "#f8fafc",
      bodyBackground: "#ffffff",
      supportText: "You are receiving this because it was sent from a BookingGPT destination email test.",
    },
  );

  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: PARTNERS_FROM_EMAIL,
    bcc: normalizedRecipients,
    subject: campaignSubject,
    html,
  });
};

export const sendPartnerMonthlyReportEmail = async ({
  claim,
  monthlyReport,
  competitorInsights,
  pdfBuffer,
  filename,
}) => {
  const toEmail = String(claim?.contact_email || "").trim().toLowerCase();
  if (!toEmail || !pdfBuffer) return { skipped: true, reason: "missing-recipient-or-pdf" };
  const hotelName = claim?.hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolveDashboardUrl(claim?.hotel_id);
  const monthLabel = monthlyReport?.monthLabel || "Current month";

  const html = buildPartnerEmailBody({
    subject: `${hotelName}: your ${monthLabel} BookingGPT report`,
    intro: `Your monthly Featured report is ready. It includes BookingGPT Reach, clicks, surface mix and city-level competitor insights.`,
    bullets: [
      monthlyReport?.reach != null ? `Reach this month: ${monthlyReport.reach}` : null,
      monthlyReport?.clicks != null ? `Clicks this month: ${monthlyReport.clicks}` : null,
      monthlyReport?.ctrPercent != null ? `CTR this month: ${monthlyReport.ctrPercent}%` : null,
      competitorInsights?.city ? `City benchmark: ${competitorInsights.city}` : null,
    ].filter(Boolean),
    outro: "The PDF is attached to this email and the same report is available from your dashboard.",
    ctaLabel: "Open dashboard",
    ctaUrl: dashboardUrl,
  });

  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: toEmail,
    subject: `${hotelName}: your ${monthLabel} BookingGPT report`,
    html,
    attachments: [
      {
        filename: filename || `bookinggpt-partner-report-${claim.hotel_id}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
  return { skipped: false };
};
