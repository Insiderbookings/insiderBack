import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicPartnerProfile,
  getPartnerResponseTimeOption,
  normalizePartnerProfileOverrides,
  PARTNER_CLAIM_STATUSES,
  PARTNER_SUBSCRIPTION_STATUSES,
  getPartnerPlanByCode,
  resolvePartnerBadgePriority,
  resolvePartnerFeatureAccess,
  resolvePartnerProfileFromClaim,
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
  assert.equal(program.trialActive, true);
  assert.equal(program.priceVisible, false);
});

test("subscribed Pro claims resolve to Preferred badge", () => {
  const claim = {
    id: 11,
    hotel_id: 43,
    claim_status: PARTNER_CLAIM_STATUSES.subscribed,
    subscription_status: PARTNER_SUBSCRIPTION_STATUSES.active,
    current_plan_code: "preferred",
    trial_started_at: "2026-03-01T10:00:00.000Z",
    trial_ends_at: "2026-03-31T10:00:00.000Z",
    next_billing_at: "2026-04-15T10:00:00.000Z",
  };

  const program = resolvePartnerProgramFromClaim(claim, "2026-04-01T12:00:00.000Z");
  assert.equal(program.badgeCode, "preferred");
  assert.equal(program.badgePriority, 2);
  assert.equal(program.planCode, "preferred");
  assert.equal(program.trialActive, false);
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

test("legacy tier codes still resolve to the new public plan names", () => {
  assert.equal(getPartnerPlanByCode("starter")?.code, "verified");
  assert.equal(getPartnerPlanByCode("pro")?.code, "preferred");
  assert.equal(getPartnerPlanByCode("elite")?.code, "featured");
});

test("trial claims expose Preferred+ listing controls through the normalized profile", () => {
  const claim = {
    id: 13,
    hotel_id: 45,
    claim_status: PARTNER_CLAIM_STATUSES.trialActive,
    trial_started_at: "2026-03-01T10:00:00.000Z",
    trial_ends_at: "2026-03-31T10:00:00.000Z",
    contact_email: "hotel@example.com",
    profile_overrides: {
      responseTimeCode: "same_day",
      specialOfferText: "Free airport transfer when you book direct.",
      inquiryEnabled: true,
      inquiryCtaLabel: "Ask this hotel",
      destinationEmailEnabled: true,
      reviewBoostEnabled: true,
      googleReviewUrl: "https://g.page/r/sample-review",
    },
    hotel: {
      city_name: "Dubai",
    },
  };

  const profile = resolvePartnerProfileFromClaim(claim, "2026-03-10T12:00:00.000Z");
  assert.equal(profile.features.bookingInquiryVisible, true);
  assert.equal(profile.features.destinationEmailsVisible, true);
  assert.equal(profile.features.reviewBoostVisible, true);
  assert.equal(profile.features.specialOffersEditable, true);
  assert.equal(profile.responseTimeLabel, "Replies the same day");
  assert.equal(profile.specialOfferText, "Free airport transfer when you book direct.");
  assert.equal(profile.inquiryEnabled, true);
  assert.equal(profile.destinationEmailEligible, true);
  assert.equal(profile.reviewBoostEnabled, true);
  assert.equal(buildPublicPartnerProfile(claim, "2026-03-10T12:00:00.000Z").inquiryEnabled, true);
});

test("verified subscribers cannot show or edit Preferred+ listing controls", () => {
  const claim = {
    id: 14,
    hotel_id: 46,
    claim_status: PARTNER_CLAIM_STATUSES.subscribed,
    subscription_status: PARTNER_SUBSCRIPTION_STATUSES.active,
    current_plan_code: "verified",
    profile_overrides: {
      responseTimeCode: "one_hour",
      specialOfferText: "This should stay hidden on Verified.",
      inquiryEnabled: true,
    },
  };

  const access = resolvePartnerFeatureAccess(claim, "2026-04-10T12:00:00.000Z");
  const profile = resolvePartnerProfileFromClaim(claim, "2026-04-10T12:00:00.000Z");
  assert.equal(access.bookingInquiryVisible, false);
  assert.equal(access.specialOffersEditable, false);
  assert.equal(profile.responseTimeLabel, null);
  assert.equal(profile.specialOfferText, null);
  assert.equal(profile.inquiryEnabled, false);
});

test("profile overrides normalize only supported values", () => {
  const normalized = normalizePartnerProfileOverrides({
    responseTimeCode: "three_hours",
    specialOfferText: "  Late checkout included for direct inquiries.  ",
    inquiryEnabled: true,
    inquiryEmail: " SALES@Hotel.com ",
    inquiryPhone: "  +1 555 100 200  ",
    inquiryCtaLabel: "  Ask the concierge  ",
    destinationEmailEnabled: true,
    reviewBoostEnabled: true,
    googleReviewUrl: " https://maps.google.com/?cid=12345 ",
  });

  assert.equal(getPartnerResponseTimeOption(normalized.responseTimeCode)?.code, "three_hours");
  assert.equal(normalized.specialOfferText, "Late checkout included for direct inquiries.");
  assert.equal(normalized.inquiryEmail, "sales@hotel.com");
  assert.equal(normalized.inquiryPhone, "+1 555 100 200");
  assert.equal(normalized.inquiryCtaLabel, "Ask the concierge");
  assert.equal(normalized.destinationEmailEnabled, true);
  assert.equal(normalized.reviewBoostEnabled, true);
  assert.equal(normalized.googleReviewUrl, "https://maps.google.com/?cid=12345");
});
