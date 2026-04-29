import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_CLAIM_STATUSES,
  PARTNER_SUBSCRIPTION_STATUSES,
  getPartnerIncludedFeatures,
  getPartnerNewFeatures,
  getPartnerPlanByCode,
  getPartnerPlanCapabilities,
  getPartnerPlans,
  resolvePartnerBadgePriority,
  resolvePartnerProgramFromClaim,
} from "../../src/services/partnerCatalog.service.js";

test("trial claims resolve to Featured badge during the free window", () => {
  const claim = {
    id: 10,
    hotel_id: 42,
    claim_status: PARTNER_CLAIM_STATUSES.trialActive,
    trial_started_at: "2026-03-01T10:00:00.000Z",
    trial_ends_at: "2026-03-31T10:00:00.000Z",
  };

  const program = resolvePartnerProgramFromClaim(claim, "2026-03-10T12:00:00.000Z");
  assert.equal(program.badgeCode, "featured");
  assert.equal(program.planCode, "featured");
  assert.equal(program.planLegacyCode, "elite");
  assert.equal(program.trialActive, true);
  assert.equal(program.priceVisible, false);
});

test("subscribed legacy Pro claims resolve to Preferred badge with canonical plan codes", () => {
  const claim = {
    id: 11,
    hotel_id: 43,
    claim_status: PARTNER_CLAIM_STATUSES.subscribed,
    subscription_status: PARTNER_SUBSCRIPTION_STATUSES.active,
    current_plan_code: "pro",
    trial_started_at: "2026-03-01T10:00:00.000Z",
    trial_ends_at: "2026-03-31T10:00:00.000Z",
    next_billing_at: "2026-04-15T10:00:00.000Z",
  };

  const program = resolvePartnerProgramFromClaim(claim, "2026-04-01T12:00:00.000Z");
  assert.equal(program.badgeCode, "preferred");
  assert.equal(program.badgePriority, 2);
  assert.equal(program.planCode, "preferred");
  assert.equal(program.planLegacyCode, "pro");
  assert.equal(program.trialActive, false);
});

test("legacy plan aliases still resolve to canonical partner plans", () => {
  assert.equal(getPartnerPlanByCode("starter")?.code, "verified");
  assert.equal(getPartnerPlanByCode("pro")?.code, "preferred");
  assert.equal(getPartnerPlanByCode("elite")?.code, "featured");
});

test("plan capabilities resolve cumulatively across verified, preferred, and featured", () => {
  const verified = getPartnerPlanCapabilities("verified");
  const preferred = getPartnerPlanCapabilities("preferred");
  const featured = getPartnerPlanCapabilities("featured");

  assert.equal(verified.listedInSearch, true);
  assert.equal(verified.fullProfileEditor, false);
  assert.equal(preferred.basicProfile, true);
  assert.equal(preferred.fullProfileEditor, true);
  assert.equal(preferred.topOfSearchResults, false);
  assert.equal(featured.fullProfileEditor, true);
  assert.equal(featured.bookingInquiry, true);
  assert.equal(featured.topOfSearchResults, true);
  assert.equal(featured.monthlyPdfReport, true);
});

test("plan feature metadata marks inherited and new benefits correctly", () => {
  const preferredIncluded = getPartnerIncludedFeatures("preferred");
  const featuredNew = getPartnerNewFeatures("featured");

  const inheritedVerifiedFeature = preferredIncluded.find((feature) => feature.key === "basicProfile");
  const nativePreferredFeature = preferredIncluded.find((feature) => feature.key === "bookingInquiry");
  const featuredOnlyFeature = featuredNew.find((feature) => feature.key === "monthlyPdfReport");

  assert.equal(inheritedVerifiedFeature?.introducedInPlanCode, "verified");
  assert.equal(inheritedVerifiedFeature?.inherited, true);
  assert.equal(nativePreferredFeature?.introducedInPlanCode, "preferred");
  assert.equal(nativePreferredFeature?.inherited, false);
  assert.equal(featuredOnlyFeature?.introducedInPlanCode, "featured");
  assert.equal(featuredOnlyFeature?.inherited, false);
});

test("serialized plans expose inheritance metadata and landing copy", () => {
  const plans = getPartnerPlans();
  const featured = plans.find((plan) => plan.code === "featured");
  const preferred = plans.find((plan) => plan.code === "preferred");

  assert.equal(preferred?.inheritsFrom, "verified");
  assert.equal(featured?.inheritsFrom, "preferred");
  assert.equal(featured?.landingNote, "30 days free");
  assert.match(String(featured?.summary || ""), /Maximum visibility/i);
  assert.ok(Array.isArray(featured?.newFeatures) && featured.newFeatures.length > 0);
});

test("expired claims resolve without badge and partner priority falls back to zero", () => {
  const claim = {
    id: 12,
    hotel_id: 44,
    claim_status: PARTNER_CLAIM_STATUSES.expired,
    trial_started_at: "2026-03-01T10:00:00.000Z",
    trial_ends_at: "2026-03-31T10:00:00.000Z",
  };

  const program = resolvePartnerProgramFromClaim(claim, "2026-04-04T12:00:00.000Z");
  assert.equal(program.badgeCode, null);
  assert.equal(program.statusLabel, "Badge removed");
  assert.equal(resolvePartnerBadgePriority({ partnerProgram: program }), 0);
});
