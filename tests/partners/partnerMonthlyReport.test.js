import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPartnerMonthlyReportComparison,
  buildPartnerMonthlyReportSummary,
  formatPartnerMonthlyReportMonthLabel,
  getPartnerMonthlyReportOverviewForClaim,
  getPartnerMonthlyReportPdfDownloadForClaim,
  resolvePartnerMonthlyReportMonth,
} from "../../src/services/partnerMonthlyReport.service.js";
import models from "../../src/models/index.js";

test("monthly report month defaults to the latest closed calendar month", () => {
  assert.equal(
    resolvePartnerMonthlyReportMonth(null, {
      now: new Date("2026-04-28T12:00:00.000Z"),
    }),
    "2026-03",
  );
  assert.equal(
    resolvePartnerMonthlyReportMonth(null, {
      now: new Date("2026-01-03T12:00:00.000Z"),
    }),
    "2025-12",
  );
});

test("monthly report month labels resolve in a partner-friendly format", () => {
  assert.equal(formatPartnerMonthlyReportMonthLabel("2026-03"), "March 2026");
});

test("comparison helper captures growth direction and percentage", () => {
  const comparison = buildPartnerMonthlyReportComparison(150, 100);
  assert.equal(comparison.current, 150);
  assert.equal(comparison.previous, 100);
  assert.equal(comparison.delta, 50);
  assert.equal(comparison.direction, "up");
  assert.equal(comparison.percentage, 50);
});

test("summary copy emphasizes direct leads when inquiries were delivered", () => {
  const summary = buildPartnerMonthlyReportSummary({
    claim: {
      claimed_at: "2026-03-10T12:00:00.000Z",
    },
    monthRange: {
      label: "March 2026",
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-04-01T00:00:00.000Z"),
    },
    partnerProgram: {
      capabilities: {
        bookingInquiry: true,
        specialOffers: true,
      },
    },
    metrics: {
      visibility: {
        trackedViews: {
          current: 420,
          delta: 80,
        },
      },
      favorites: {
        newThisMonth: {
          current: 12,
        },
      },
      inquiries: {
        total: {
          current: 6,
        },
        delivered: 5,
        deliveryIssues: 1,
      },
      profile: {
        inquiryReady: true,
        completionPercent: 92,
        specialOffersEnabled: true,
      },
    },
  });

  assert.match(summary.headline, /direct hotel leads/i);
  assert.equal(summary.highlights.length >= 3, true);
  assert.match(String(summary.partialMonthNote || ""), /partial month/i);
  assert.equal(summary.nextActions.length >= 1, true);
});

test("monthly report overview is blocked for plans below Featured", async () => {
  const originalFindAll = models.PartnerMonthlyReport.findAll;
  let findAllCalled = false;
  models.PartnerMonthlyReport.findAll = async () => {
    findAllCalled = true;
    return [];
  };

  try {
    await assert.rejects(
      () =>
        getPartnerMonthlyReportOverviewForClaim({
          claim: {
            id: 81,
            hotel_id: 335115,
            claim_status: "SUBSCRIBED",
            subscription_status: "active",
            current_plan_code: "preferred",
            hotel: {
              name: "Hotel Preferred",
            },
            hotelProfile: null,
          },
          now: new Date("2026-04-28T12:00:00.000Z"),
        }),
      (error) => {
        assert.equal(error?.status, 403);
        assert.match(String(error?.message || ""), /featured plan/i);
        return true;
      },
    );
    assert.equal(findAllCalled, false);
  } finally {
    models.PartnerMonthlyReport.findAll = originalFindAll;
  }
});

test("monthly report download is blocked for plans below Featured even if a report exists", async () => {
  const originalFindOne = models.PartnerMonthlyReport.findOne;
  let findOneCalled = false;
  models.PartnerMonthlyReport.findOne = async () => {
    findOneCalled = true;
    return {
      id: 9,
    };
  };

  try {
    await assert.rejects(
      () =>
        getPartnerMonthlyReportPdfDownloadForClaim({
          claim: {
            id: 82,
            hotel_id: 335116,
            claim_status: "SUBSCRIBED",
            subscription_status: "active",
            current_plan_code: "preferred",
            hotel: {
              name: "Hotel Preferred",
            },
            hotelProfile: null,
          },
          reportMonth: "2026-03",
          now: new Date("2026-04-28T12:00:00.000Z"),
        }),
      (error) => {
        assert.equal(error?.status, 403);
        assert.match(String(error?.message || ""), /featured plan/i);
        return true;
      },
    );
    assert.equal(findOneCalled, false);
  } finally {
    models.PartnerMonthlyReport.findOne = originalFindOne;
  }
});
