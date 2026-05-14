import transporter from "./transporter.js";
import { getBaseEmailTemplate } from "../emailTemplates/base-template.js";
import { resolveMailFrom } from "../helpers/mailFrom.js";
import { buildPartnerPortalUrl } from "../helpers/appUrls.js";
import {
  PARTNER_EMAIL_SEQUENCE,
  getPartnerPlanByCode,
  resolvePartnerProgramFromClaim,
} from "./partnerCatalog.service.js";

const PARTNERS_FROM_EMAIL = resolveMailFrom(
  process.env.PARTNERS_FROM_EMAIL || process.env.SMTP_FROM || null,
);
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

const normalizeEmail = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || null;
};

const formatDayCount = (value) => {
  const numeric = Number(value);
  const rounded =
    Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
};

export const resolvePartnerDashboardUrl = (
  hotelId = null,
  extraParams = {},
) => {
  const params = { ...extraParams };
  if (hotelId) params.hotelId = String(hotelId);
  let dashboardPath = "partners/dashboard";
  try {
    const portalBase = new URL(buildPartnerPortalUrl());
    const baseSegments = portalBase.pathname
      .split("/")
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
    if (baseSegments.includes("partners")) {
      dashboardPath = "dashboard";
    }
  } catch {
    dashboardPath = "partners/dashboard";
  }
  return buildPartnerPortalUrl(dashboardPath, params);
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
      supportText:
        "Questions? Reply to this email and the BookingGPT team will help.",
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

const getPartnerPerformanceSnapshot = (claim) => {
  const performance = claim?.partnerPerformance || {};
  return {
    reachTotal: Number(performance?.bookingGptReach?.total || 0) || 0,
    last7Days:
      Number(
        performance?.bookingGptReach?.last7Days ||
          performance?.views?.last7Days ||
          0,
      ) || 0,
    clicks: Number(performance?.clicks?.total || 0) || 0,
    favorites: Number(performance?.favorites?.total || 0) || 0,
  };
};

const normalizeProfileCompletion = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const getPartnerSetupSnapshot = ({ claim, program }) => {
  const profile = claim?.hotelProfile || null;
  const profileCompletion = profile
    ? normalizeProfileCompletion(profile?.profile_completion)
    : null;
  const partnerInbox = normalizeEmail(
    profile?.contact_email || claim?.contact_email || null,
  );
  const inquiryFeatureEnabled = Boolean(program?.capabilities?.bookingInquiry);
  const inquiryEnabled = profile ? Boolean(profile?.inquiry_enabled) : null;
  const inquiryDestination = normalizeEmail(
    profile?.inquiry_email ||
      profile?.contact_email ||
      claim?.contact_email ||
      null,
  );
  let inquiryLabel = "Review now";
  let inquiryNote = "confirm the traveler inquiry path in the dashboard";

  if (!inquiryFeatureEnabled) {
    inquiryLabel = "Locked";
    inquiryNote =
      "available once the active plan enables direct traveler inquiries";
  } else if (inquiryEnabled === true && inquiryDestination) {
    inquiryLabel = "Ready";
    inquiryNote = `traveler messages route to ${inquiryDestination}`;
  } else if (inquiryEnabled === true) {
    inquiryLabel = "Needs inbox";
    inquiryNote = "add a destination email before more traveler intent arrives";
  } else if (inquiryEnabled === false) {
    inquiryLabel = "Off";
    inquiryNote = "turn on direct inquiries so travelers can reach the hotel";
  }

  const specialOfferFeatureEnabled = Boolean(
    program?.capabilities?.specialOffers,
  );
  const specialOffersEnabled = profile
    ? Boolean(profile?.special_offers_enabled)
    : null;
  let specialOfferLabel = specialOfferFeatureEnabled ? "Review now" : "Locked";
  let specialOfferNote = specialOfferFeatureEnabled
    ? "consider adding a public offer before more trial traffic arrives"
    : "available on plans with special offers enabled";

  if (specialOfferFeatureEnabled && specialOffersEnabled === true) {
    specialOfferLabel = "Live";
    specialOfferNote = "traveler-facing promotion is already active";
  } else if (specialOfferFeatureEnabled && specialOffersEnabled === false) {
    specialOfferLabel = "Off";
    specialOfferNote = "no public promotion is live yet";
  }

  return {
    profileCompletion,
    partnerInbox,
    inquiryFeatureEnabled,
    inquiryLabel,
    inquiryNote,
    inquiryReady: inquiryLabel === "Ready",
    specialOfferFeatureEnabled,
    specialOfferLabel,
    specialOfferNote,
    specialOffersEnabled: specialOffersEnabled === true,
  };
};

const buildWeekOneSetupStats = ({ claim, program }) => {
  const performance = getPartnerPerformanceSnapshot(claim);
  const setup = getPartnerSetupSnapshot({ claim, program });
  return [
    setup.profileCompletion != null
      ? {
          label: "Profile completion",
          value: `${setup.profileCompletion}%`,
          note: "public listing setup progress",
        }
      : {
          label: "BookingGPT Reach",
          value: formatCount(performance.reachTotal),
          note: "visibility recorded in the trial so far",
        },
    {
      label: "Inquiry routing",
      value: setup.inquiryLabel,
      note: setup.inquiryNote,
    },
    setup.specialOfferFeatureEnabled
      ? {
          label: "Special offer",
          value: setup.specialOfferLabel,
          note: setup.specialOfferNote,
        }
      : {
          label: "Clicks",
          value: formatCount(performance.clicks),
          note: "travelers who clicked through so far",
        },
    {
      label: "Partner inbox",
      value: setup.partnerInbox || "Missing",
      note: setup.partnerInbox
        ? "main partner contact on file"
        : "add a working contact email in the dashboard",
    },
  ];
};

const buildWeekTwoPerformanceStats = ({ claim }) => {
  const performance = getPartnerPerformanceSnapshot(claim);
  return [
    {
      label: "BookingGPT Reach",
      value: formatCount(performance.reachTotal),
      note: "visibility accumulated in the trial so far",
    },
    {
      label: "Last 7 days",
      value: formatCount(performance.last7Days),
      note: "recent visibility during the second week",
    },
    {
      label: "Clicks",
      value: formatCount(performance.clicks),
      note: "travelers who clicked through so far",
    },
    {
      label: "Favorites",
      value: formatCount(performance.favorites),
      note: "travelers who saved the hotel",
    },
  ];
};

const buildMidpointReviewStats = ({ claim, program }) => {
  const setup = getPartnerSetupSnapshot({ claim, program });
  const trialEndLabel = formatDate(program?.trialEndsAt);
  return [
    {
      label: "Trial time left",
      value: formatDayCount(program?.trialDaysLeft),
      note: trialEndLabel ? `trial ends ${trialEndLabel}` : "midpoint reached",
    },
    {
      label: "Badge status",
      value: program?.badgeLabel || "Featured",
      note: "still live in the trial",
    },
    setup.profileCompletion != null
      ? {
          label: "Profile completion",
          value: `${setup.profileCompletion}%`,
          note: "listing setup progress",
        }
      : {
          label: "Partner inbox",
          value: setup.partnerInbox || "Missing",
          note: setup.partnerInbox
            ? "main partner contact on file"
            : "add a working contact email in the dashboard",
        },
    {
      label: "Inquiry routing",
      value: setup.inquiryLabel,
      note: setup.inquiryNote,
    },
  ];
};

const buildWeekThreeConversionStats = ({ claim, program }) => {
  const performance = getPartnerPerformanceSnapshot(claim);
  const trialEndLabel = formatDate(program?.trialEndsAt);
  return [
    {
      label: "BookingGPT Reach",
      value: formatCount(performance.reachTotal),
      note: "visibility accumulated before plan selection",
    },
    {
      label: "Clicks",
      value: formatCount(performance.clicks),
      note: "traveler interest already reaching the listing",
    },
    {
      label: "Favorites",
      value: formatCount(performance.favorites),
      note: "travelers who want to return to the hotel",
    },
    {
      label: "Trial ends",
      value: trialEndLabel || formatDayCount(program?.trialDaysLeft),
      note: trialEndLabel
        ? `${formatDayCount(program?.trialDaysLeft)} left before the badge review`
        : "plan pricing unlocks on day 25",
    },
  ];
};

const getPlanSelectionStats = ({
  program,
  includeDaysLeft = false,
  badgeStatus = null,
  discountOffer = null,
}) => {
  const stats = [];
  if (includeDaysLeft) {
    const trialDaysLeft = Number(program?.trialDaysLeft || 0);
    stats.push({
      label: "Time left",
      value: `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"}`,
      note: program?.trialEndsAt
        ? `trial ends ${formatDate(program.trialEndsAt)}`
        : "trial still active",
    });
  } else if (badgeStatus) {
    stats.push({
      label: "Badge status",
      value: badgeStatus,
      note: program?.trialEndsAt
        ? `trial ended ${formatDate(program.trialEndsAt)}`
        : "",
    });
  } else if (program?.trialEndsAt) {
    stats.push({
      label: "Trial ends",
      value: formatDate(program.trialEndsAt),
      note: "partner pricing is now available",
    });
  }
  if (discountOffer) {
    stats.push({
      label: discountOffer.label,
      value: discountOffer.value,
      note: discountOffer.note,
    });
  }
  return [...stats, ...getPlanPricingStats()];
};

const getRequestedPlanLabel = (claim) =>
  getPartnerPlanByCode(claim?.pending_plan_code || claim?.current_plan_code)
    ?.label ||
  claim?.pending_plan_code ||
  claim?.current_plan_code ||
  null;

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
    focus: "plans",
  });
  const trialEndLabel = formatDate(program?.trialEndsAt);
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
            note: trialEndLabel
              ? `scheduled to end ${trialEndLabel}`
              : "no card required now",
          },
        ],
        bullets: [
          "Your partner dashboard is ready right now.",
          "No card is required to explore the dashboard or complete setup.",
          "Top 3 first actions: confirm your hotel contact, review the public profile, and prepare inquiry routing.",
        ],
        outro:
          "Use the dashboard to review your listing, understand the lifecycle timeline and prepare for plan selection later in the trial.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    case "day_7_report": {
      const performance = getPartnerPerformanceSnapshot(claim);
      const setup = getPartnerSetupSnapshot({ claim, program });
      return {
        subject: `${hotelName}: your week 1 BookingGPT trial report`,
        preheader: `Week 1 setup review for ${hotelName}, with the trial still live and the dashboard ready.`,
        intro: `Week 1 is complete and your Featured trial is still active on BookingGPT. This first check-in is about tightening the listing setup while visibility is already building for ${hotelName}.`,
        stats: buildWeekOneSetupStats({ claim, program }),
        bullets: [
          `BookingGPT Reach so far: ${formatCount(performance.reachTotal)}, with ${formatCount(performance.clicks)} traveler clicks already recorded.`,
          "Hotels at this stage that complete setup early tend to keep more visibility after the trial.",
          `Your listing is ${setup.profileCompletion != null ? `${setup.profileCompletion}% complete` : "still being built"}. Review the profile, inquiry routing and public offer fields this week.`,
          !setup.inquiryFeatureEnabled
            ? "Direct traveler inquiries stay locked until the active plan enables them."
            : setup.inquiryReady
              ? "Direct inquiry routing is already live, so traveler messages can reach the hotel inbox without delay."
              : setup.inquiryLabel === "Needs inbox"
                ? "Direct inquiries are enabled but still need a delivery inbox before they become reliable."
                : "Turn on direct inquiry routing so future traveler intent has a clear path to the hotel.",
        ],
        outro:
          "Open the dashboard to review the profile section, confirm inquiry routing and make sure the next two weeks of the trial land on a stronger listing.",
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    }
    case "day_14_report": {
      const performance = getPartnerPerformanceSnapshot(claim);
      const setup = getPartnerSetupSnapshot({ claim, program });
      return {
        subject: `${hotelName}: your week 2 BookingGPT trial report`,
        preheader: `Week 2 traction update for ${hotelName}, with live visibility and traveler intent signals so far.`,
        intro: `Week 2 is complete and your Featured trial is still active on BookingGPT. This update focuses on the visibility and traveler traction building around ${hotelName}.`,
        stats: buildWeekTwoPerformanceStats({ claim }),
        bullets: [
          `Saved to favorites so far: ${formatCount(performance.favorites)}.`,
          "Review this week what similar hotels are doing: clean photos, strong amenities and a clear contact workflow.",
          performance.clicks > 0 || performance.favorites > 0
            ? `Traveler intent is starting to show up beyond raw visibility${performance.clicks > 0 && performance.favorites > 0 ? ", in both clicks and saves." : "."}`
            : "Visibility is building, but traveler intent is still light enough that listing improvements can matter before the second half of the trial.",
          setup.profileCompletion != null && setup.profileCompletion < 80
            ? `The listing is still ${setup.profileCompletion}% complete. Improving copy, photos and amenities can help the traffic already coming in convert better.`
            : setup.inquiryFeatureEnabled && !setup.inquiryReady
              ? "Finish the inquiry setup now so any late-trial traveler interest has a direct route into the hotel inbox."
              : "Your listing fundamentals are in good shape, so the next focus is keeping the message current while the trial keeps running.",
        ],
        outro:
          "Open the dashboard to review the latest reach, update the listing and make sure the visibility already building has the best chance to convert.",
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    }
    case "day_15_midpoint": {
      const performance = getPartnerPerformanceSnapshot(claim);
      const setup = getPartnerSetupSnapshot({ claim, program });
      const hasSetupGaps =
        (setup.profileCompletion != null && setup.profileCompletion < 80) ||
        (setup.inquiryFeatureEnabled && !setup.inquiryReady) ||
        (setup.specialOfferFeatureEnabled && !setup.specialOffersEnabled);
      return {
        subject: `${hotelName}: you are halfway through your trial`,
        preheader: `${hotelName} has reached the midpoint of the BookingGPT Featured trial.`,
        intro: `You are halfway through the 30-day BookingGPT Featured trial for ${hotelName}. This checkpoint is about reviewing what the trial has already produced and what still needs attention before pricing appears on day 25.`,
        stats: buildMidpointReviewStats({ claim, program }),
        bullets: [
          "Your hotel remains visible with the Featured badge.",
          `So far the trial has generated ${formatCount(performance.reachTotal)} tracked views, ${formatCount(performance.clicks)} clicks and ${formatCount(performance.favorites)} traveler saves.`,
          "Partners who finish their setup by midpoint are more likely to keep the badge after trial day 30.",
          hasSetupGaps
            ? "The midpoint is the right moment to close setup gaps before pricing appears on day 25."
            : "The setup is largely in place, so the next move is monitoring performance and preparing for the day 25 plan decision.",
          setup.inquiryFeatureEnabled && !setup.inquiryReady
            ? "If you want traveler intent to become direct leads, finish the inquiry setup before the last stretch of the trial."
            : "Plan pricing stays hidden until day 25, so you can keep focusing on the listing before the subscription decision.",
        ],
        outro:
          "Use the dashboard to review setup quality, keep the listing current and make sure the second half of the trial compounds on a stronger hotel page.",
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    }
    case "day_21_report": {
      const performance = getPartnerPerformanceSnapshot(claim);
      const setup = getPartnerSetupSnapshot({ claim, program });
      return {
        subject: `${hotelName}: your week 3 BookingGPT trial report`,
        preheader: `Week 3 partner summary for ${hotelName}, with the final pre-plan-selection visibility snapshot.`,
        intro: `Week 3 is complete and your Featured trial is still active on BookingGPT. This is the last full weekly update before pricing unlocks, so the goal now is understanding what momentum already exists and what should be protected.`,
        stats: buildWeekThreeConversionStats({ claim, program }),
        bullets: [
          "Partner pricing unlocks on day 25, so this is the last full week to review the trial before plan selection opens.",
          "Protect the momentum you have now: the visibility earned during the trial is the strongest asset before pricing begins.",
          performance.clicks > 0 || performance.favorites > 0
            ? `The hotel has already generated ${formatCount(performance.clicks)} clicks and ${formatCount(performance.favorites)} traveler saves, which is the demand signal worth protecting if the listing keeps growing.`
            : "The remaining trial days should focus on tightening the listing so the visibility already earned has a better chance to convert.",
          setup.inquiryFeatureEnabled && setup.inquiryReady
            ? "Direct inquiry routing is ready, so late-trial traveler intent already has a clean path into the hotel inbox."
            : "If you want late-trial traveler intent to become direct leads, complete the inquiry setup before the trial ends.",
        ],
        outro:
          "Open the dashboard to review the full trial snapshot, prepare the plan decision and make sure the final stretch of visibility supports the hotel's next step.",
        ctaLabel: "Review dashboard",
        ctaUrl: dashboardUrl,
      };
    }
    case "day_25_choose_plan":
      return {
        subject: `${hotelName}: 5 days left to keep your badge — 5% off first month today`,
        preheader: `Partner pricing is now visible. Activate today to keep your badge and get 5% off the first month.`,
        intro: `Your BookingGPT trial is entering its final stretch. Choose a plan now to keep partner badge visibility active when the trial ends${trialEndLabel ? ` on ${trialEndLabel}` : ""}.`,
        stats: getPlanSelectionStats({
          program,
          discountOffer: {
            label: "Today only",
            value: "5% off first month",
            note: "available when you activate the first subscription today",
          },
        }),
        bullets: [
          "Activate any plan today and receive 5% off the first month's subscription.",
          "Verified keeps an active partner badge on the listing.",
          "Preferred adds stronger visibility and enhanced partner lifecycle features.",
          "Featured keeps the strongest placement and the full premium partner feature set.",
          "Card payments lock the discount immediately; invoice requests are still available.",
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
        intro: `There are 3 days left before the partner badge is removed from ${hotelName}. This is your last window to protect the visibility earned during the trial.`,
        stats: getPlanSelectionStats({ program, includeDaysLeft: true }),
        bullets: [
          "Card activation keeps the badge live immediately.",
          "Invoice requests stay pending until payment is confirmed.",
          "Compare with and without the badge: the active plan preserves visibility and traveler signal.",
          "If you want help choosing the best plan, reply to this email or open the dashboard today.",
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
          "If you'd like help, reply to this email and we will support your plan choice.",
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
        intro: `The 30-day trial has ended and the partner badge has now been removed from ${hotelName}. Your hotel is still visible, but without premium placement.`,
        stats: getPlanSelectionStats({ program, badgeStatus: "Removed" }),
        bullets: [
          "Your hotel is still listed on BookingGPT.",
          "The premium partner badge and boosted placement return as soon as a plan is activated.",
          "Restore visibility now from the dashboard and recover the momentum already built.",
          "If you want help choosing the fastest restoration option, reply to this email.",
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
          "Reactivating now can recover the momentum from your trial period.",
        ],
        outro:
          "Open the dashboard when you are ready to reactivate the plan that fits this property.",
        ctaLabel: "Restore my badge",
        ctaUrl: subscriptionDashboardUrl,
      };
    case "day_37_last_message":
      return {
        subject: `${hotelName}: final message about your badge`,
        preheader: `Final partner follow-up for ${hotelName}. The badge can still return.`,
        intro: `This is the final automated follow-up for ${hotelName} in the BookingGPT launch sequence. The badge can still return once the right plan is selected.`,
        stats: getPlanSelectionStats({ program, badgeStatus: "Inactive" }),
        bullets: [
          "Your badge is ready to return as soon as you pick a plan.",
          "Verified, Preferred and Featured remain available in the dashboard.",
          "After this message, the automatic follow-up sequence stops.",
          "If you'd like support, reply to this email and our team will help you choose the next step.",
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
            note: program?.badgeLabel
              ? `${program.badgeLabel} badge`
              : "partner plan active",
          },
          {
            label: "Monthly billing",
            value:
              formatMoney(program?.priceMonthly, program?.currency) || "Custom",
            note: "per month",
          },
          {
            label: "Next billing date",
            value: formatDate(program?.nextBillingAt) || "TBD",
            note: "based on the current subscription",
          },
          {
            label: "Payment method",
            value: claim?.billing_method
              ? String(claim.billing_method).toUpperCase()
              : "CARD",
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
      const fallback = PARTNER_EMAIL_SEQUENCE.find(
        (entry) => entry.key === emailKey,
      );
      return {
        subject: fallback?.subject || "BookingGPT Partners update",
        preheader:
          fallback?.preview || "Your BookingGPT partner status was updated.",
        intro:
          fallback?.preview || "Your BookingGPT partner status was updated.",
        ctaLabel: "Open dashboard",
        ctaUrl: dashboardUrl,
      };
    }
  }
};

export const sendPartnerLifecycleEmail = async ({ claim, hotel, emailKey }) => {
  const toEmail = String(claim?.contact_email || "")
    .trim()
    .toLowerCase();
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

export const sendPartnerInternalManualReviewAlert = async ({
  claim,
  hotel,
  user,
  review,
}) => {
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id);
  const rows = [
    ["Hotel", hotelName],
    ["Hotel ID", claim?.hotel_id],
    ["Claim ID", claim?.id],
    [
      "Source",
      PARTNER_CLAIM_SOURCE_LABELS[
        String(review?.source || "")
          .trim()
          .toLowerCase()
      ] || "-",
    ],
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

export const sendPartnerInternalInvoiceAlert = async ({
  claim,
  hotel,
  billingDetails,
}) => {
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id);
  const requestedPlan =
    getPartnerPlanByCode(claim?.pending_plan_code || claim?.current_plan_code)
      ?.label ||
    claim?.pending_plan_code ||
    claim?.current_plan_code ||
    "-";
  const rows = [
    ["Hotel", hotelName],
    ["Hotel ID", claim?.hotel_id],
    ["Claim ID", claim?.id],
    ["Requested plan", requestedPlan],
    ["Billing name", billingDetails?.billingName || "-"],
    [
      "Billing email",
      billingDetails?.billingEmail || claim?.contact_email || "-",
    ],
    ["Account manager email", billingDetails?.accountManagerEmail || "-"],
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

export const sendPartnerHotelInquiryEmail = async ({
  claim,
  hotel,
  inquiry,
  destinationEmail,
} = {}) => {
  const toEmail = String(destinationEmail || "")
    .trim()
    .toLowerCase();
  if (!toEmail) {
    throw new Error("Missing inquiry destination email");
  }

  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id, {
    section: "profile",
  });
  const travelerName = inquiry?.traveler_name || "Traveler";
  const travelerEmail = inquiry?.traveler_email || "-";
  const travelerPhone = inquiry?.traveler_phone || "-";
  const checkIn = formatDate(inquiry?.check_in);
  const checkOut = formatDate(inquiry?.check_out);
  const guestsSummary = inquiry?.guests_summary || "-";
  const inquiryMessage = inquiry?.inquiry_message || "-";
  const sourceSurface = String(inquiry?.source_surface || "hotel_detail")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

  const rows = [
    ["Traveler", travelerName],
    ["Email", travelerEmail],
    ["Phone", travelerPhone],
    ["Check-in", checkIn || "-"],
    ["Check-out", checkOut || "-"],
    ["Guests", guestsSummary],
    ["Source", sourceSurface],
  ];

  const html = getBaseEmailTemplate(
    `
      <p style="font-size:14px;color:#475569;margin:0 0 8px;">Traveler inquiry</p>
      <h2 style="margin:0 0 16px;font-size:28px;line-height:1.15;color:#0f172a;">New inquiry for ${escapeHtml(
        hotelName,
      )}</h2>
      <p style="margin:0 0 18px;color:#334155;font-size:15px;line-height:1.7;">
        A traveler sent a direct inquiry from BookingGPT and expects the hotel to reply directly.
      </p>
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
      <div style="margin:24px 0 0;padding:16px 18px;border:1px solid #e2e8f0;border-radius:16px;background:#f8fafc;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:8px;">Traveler message</div>
        <div style="font-size:15px;line-height:1.7;color:#0f172a;white-space:pre-wrap;">${escapeHtml(
          inquiryMessage,
        )}</div>
      </div>
      ${buildCta("Open partner dashboard", dashboardUrl)}
    `,
    `New inquiry for ${hotelName}`,
    {
      brandName: "BookingGPT",
      headerTitle: "BookingGPT Partners",
      headerSubtitle: "Direct traveler inquiry",
      primaryColor: "#0f172a",
      accentColor: "#1877F2",
      backgroundColor: "#f8fafc",
      bodyBackground: "#ffffff",
      supportText:
        "Reply directly to the traveler to continue the conversation.",
      footerText: `Copyright ${new Date().getFullYear()} BookingGPT. All rights reserved.`,
      preheader: `${travelerName} sent a direct inquiry for ${hotelName}.`,
      socialLinks: [],
    },
  );
  const text = [
    `New inquiry for ${hotelName}`,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Traveler message",
    inquiryMessage,
    "",
    `Open partner dashboard: ${dashboardUrl}`,
  ].join("\n");

  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: travelerEmail,
    to: toEmail,
    subject: `New inquiry for ${hotelName}`,
    html,
    text,
  });
};

export const sendPartnerMonthlyReportEmail = async ({
  claim,
  hotel,
  report,
  pdfBuffer,
  destinationEmail,
} = {}) => {
  const toEmail = String(destinationEmail || "")
    .trim()
    .toLowerCase();
  if (!toEmail) {
    throw new Error("Missing monthly report destination email");
  }

  const metrics = report?.metrics || {};
  const summary = report?.summary || {};
  const hotelName = hotel?.name || `Hotel ${claim?.hotel_id || ""}`.trim();
  const monthLabel = metrics?.reportMonthLabel || "Monthly";
  const dashboardUrl = resolvePartnerDashboardUrl(claim?.hotel_id, {
    section: "performance",
  });
  const stats = [
    {
      label: "Tracked views",
      value: formatCount(metrics?.visibility?.trackedViews?.current || 0),
      note: `${monthLabel} in-app visibility`,
    },
    {
      label: "New favorites",
      value: formatCount(metrics?.favorites?.newThisMonth?.current || 0),
      note: "favorites added by travelers",
    },
    {
      label: "Traveler inquiries",
      value: formatCount(metrics?.inquiries?.total?.current || 0),
      note: `${formatCount(metrics?.inquiries?.delivered || 0)} delivered to the hotel`,
    },
    {
      label: "Click snapshot",
      value: formatCount(metrics?.visibility?.clicksSnapshot || 0),
      note: "current partner-reported click total",
    },
  ];

  const html = buildPartnerEmailHtml({
    subject: `${hotelName}: your ${monthLabel.toLowerCase()} PDF performance report`,
    preheader: `${monthLabel} partner summary for ${hotelName}, with the PDF report attached.`,
    eyebrow: "Monthly partner report",
    intro: `The ${monthLabel} BookingGPT partner report for ${hotelName} is attached as a PDF and ready to share internally.`,
    stats,
    bullets: Array.isArray(summary?.highlights) ? summary.highlights : [],
    outro:
      "Open the dashboard to review the latest partner setup, download past reports, and keep the listing current before the next monthly cycle closes.",
    ctaLabel: "Open dashboard",
    ctaUrl: dashboardUrl,
  });
  const text = buildPartnerLifecycleEmailText({
    subject: `${hotelName}: your ${monthLabel} PDF performance report`,
    intro: `The ${monthLabel} BookingGPT partner report for ${hotelName} is attached as a PDF and ready to share internally.`,
    stats,
    bullets: Array.isArray(summary?.highlights) ? summary.highlights : [],
    outro:
      "Open the partner dashboard to review the latest setup, download past reports, and keep the listing current before the next monthly cycle closes.",
    ctaLabel: "Open dashboard",
    ctaUrl: dashboardUrl,
  });

  await transporter.sendMail({
    from: PARTNERS_FROM_EMAIL,
    replyTo: PARTNERS_REPLY_TO_EMAIL,
    to: toEmail,
    subject: `${hotelName}: your ${monthLabel} PDF performance report`,
    html,
    text,
    attachments: [
      {
        filename: `bookinggpt-${String(claim?.hotel_id || "hotel")}-${String(report?.report_month || monthLabel).slice(0, 7)}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
};
