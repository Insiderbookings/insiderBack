import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPartnerLifecycleEmailText,
  resolvePartnerDashboardUrl,
  resolvePartnerLifecycleTemplate,
  sendPartnerMonthlyReportEmail,
} from "../../src/services/partnerEmail.service.js";
import transporter from "../../src/services/transporter.js";

const buildTrialClaim = (overrides = {}) => ({
  hotel_id: "335115",
  claim_status: "TRIAL_ACTIVE",
  current_plan_code: null,
  pending_plan_code: null,
  contact_email: "partners@example.com",
  trial_started_at: new Date("2026-04-01T12:00:00.000Z"),
  trial_ends_at: new Date("2026-05-01T12:00:00.000Z"),
  partnerPerformance: {
    bookingGptReach: {
      total: 1250,
      last7Days: 215,
    },
    clicks: {
      total: 48,
    },
    favorites: {
      total: 16,
    },
  },
  ...overrides,
});

const withPartnerClientUrl = async (url, run) => {
  const previous = process.env.PARTNERS_CLIENT_URL;
  process.env.PARTNERS_CLIENT_URL = url;
  try {
    await run();
  } finally {
    process.env.PARTNERS_CLIENT_URL = previous;
  }
};

test("resolves partner dashboard links to the dashboard route", () => {
  return withPartnerClientUrl("https://partners.bookinggpt.app", async () => {
    assert.equal(
      resolvePartnerDashboardUrl("335115"),
      "https://partners.bookinggpt.app/partners/dashboard?hotelId=335115",
    );
    assert.equal(
      resolvePartnerDashboardUrl(),
      "https://partners.bookinggpt.app/partners/dashboard",
    );
  });
});

test("builds weekly lifecycle copy with real metrics and no placeholder language", () => {
  return withPartnerClientUrl("https://bookinggpt.app", async () => {
    const template = resolvePartnerLifecycleTemplate({
      emailKey: "day_7_report",
      claim: buildTrialClaim(),
      hotel: { name: "474 Buenos Aires Hotel" },
      now: new Date("2026-04-27T20:27:42.917Z"),
    });

    assert.match(template.subject, /week 1/i);
    assert.equal(template.stats[0].label, "BookingGPT Reach");
    assert.equal(template.stats[0].value, "1,250");
    assert.equal(template.stats[1].value, "215");
    assert.equal(template.stats[2].value, "48");
    assert.equal(template.stats[3].value, "4 days");
    assert.match(template.bullets.join(" "), /Saved to favorites so far: 16/i);
    assert.equal(
      template.ctaUrl,
      "https://bookinggpt.app/partners/dashboard?hotelId=335115",
    );

    const combinedCopy = [template.intro, template.outro, ...template.bullets].join(" ").toLowerCase();
    assert.doesNotMatch(combinedCopy, /placeholder|partners spec|expanded later/);
  });
});

test("builds plan selection emails from the live catalog prices", () => {
  return withPartnerClientUrl("https://bookinggpt.app", async () => {
    const template = resolvePartnerLifecycleTemplate({
      emailKey: "day_25_choose_plan",
      claim: buildTrialClaim(),
      hotel: { name: "474 Buenos Aires Hotel" },
      now: new Date("2026-04-27T20:27:42.917Z"),
    });

    const priceStats = template.stats.slice(1);
    assert.equal(
      template.ctaUrl,
      "https://bookinggpt.app/partners/dashboard?section=subscription&focus=plans&hotelId=335115",
    );
    assert.deepEqual(
      priceStats.map((item) => [item.label, item.value]),
      [
        ["Verified", "$49"],
        ["Preferred", "$99"],
        ["Featured", "$249"],
      ],
    );
  });
});

test("renders a plain-text lifecycle fallback with highlights and CTA", () => {
  return withPartnerClientUrl("https://bookinggpt.app", async () => {
    const template = resolvePartnerLifecycleTemplate({
      emailKey: "day_15_midpoint",
      claim: buildTrialClaim(),
      hotel: { name: "474 Buenos Aires Hotel" },
      now: new Date("2026-04-15T12:00:00.000Z"),
    });

    const text = buildPartnerLifecycleEmailText(template);

    assert.match(text, /Highlights/);
    assert.match(text, /Key points/);
    assert.match(text, /Review dashboard: https:\/\/bookinggpt\.app\/partners\/dashboard\?hotelId=335115/);
  });
});

test("monthly report emails include the PDF attachment and performance summary", async () => {
  const originalSendMail = transporter.sendMail;
  const sentPayloads = [];
  const pdfBuffer = Buffer.from("fake-pdf");
  transporter.sendMail = async (payload) => {
    sentPayloads.push(payload);
    return { messageId: "monthly-report-test" };
  };

  try {
    await withPartnerClientUrl("https://bookinggpt.app", async () => {
      await sendPartnerMonthlyReportEmail({
        claim: buildTrialClaim(),
        hotel: { name: "474 Buenos Aires Hotel" },
        report: {
          report_month: "2026-03-01",
          metrics: {
            reportMonthLabel: "March 2026",
            visibility: {
              trackedViews: { current: 420 },
              clicksSnapshot: 31,
            },
            favorites: {
              newThisMonth: { current: 9 },
            },
            inquiries: {
              total: { current: 4 },
              delivered: 3,
            },
          },
          summary: {
            highlights: ["420 tracked views were recorded in March 2026."],
          },
        },
        pdfBuffer,
        destinationEmail: "team@hotel.example",
      });
    });

    assert.equal(sentPayloads.length, 1);
    assert.equal(sentPayloads[0].to, "team@hotel.example");
    assert.match(String(sentPayloads[0].subject || ""), /march 2026 pdf performance report/i);
    assert.equal(Array.isArray(sentPayloads[0].attachments), true);
    assert.equal(sentPayloads[0].attachments.length, 1);
    assert.equal(sentPayloads[0].attachments[0].content, pdfBuffer);
    assert.match(String(sentPayloads[0].attachments[0].filename || ""), /2026-03\.pdf$/i);
    assert.match(String(sentPayloads[0].text || ""), /Tracked views: 420/);
  } finally {
    transporter.sendMail = originalSendMail;
  }
});
