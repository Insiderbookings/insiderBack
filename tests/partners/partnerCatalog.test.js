import test from "node:test";
import assert from "node:assert/strict";
import {
  PARTNER_CLAIM_STATUSES,
  PARTNER_SUBSCRIPTION_STATUSES,
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
  assert.equal(program.planCode, "elite");
  assert.equal(program.trialActive, true);
  assert.equal(program.priceVisible, false);
});

test("subscribed Pro claims resolve to Preferred badge", () => {
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
  assert.equal(program.planCode, "pro");
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
