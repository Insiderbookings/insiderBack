import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTNER_VERIFICATION_CODE_PATTERN,
  buildPartnerVerificationPayload,
  normalizePartnerVerificationCodeInput,
} from "../../src/services/partnerVerification.service.js";

test("normalizes partner verification codes from user-entered formatting", () => {
  assert.equal(normalizePartnerVerificationCodeInput(" vrf-4821k "), "VRF4821K");
});

test("verification codes use the VRF plus digits plus letter format", () => {
  assert.match("VRF1234A", PARTNER_VERIFICATION_CODE_PATTERN);
  assert.doesNotMatch("123456", PARTNER_VERIFICATION_CODE_PATTERN);
});

test("active unused verification codes can activate the partner flow", () => {
  const payload = buildPartnerVerificationPayload({
    code: "VRF4821K",
    hotel: {
      hotel_id: 88,
      name: "Ocean View",
      city_name: "Miami",
      country_name: "United States",
      address: "1 Bay Road",
    },
  });

  assert.equal(payload.canActivate, true);
  assert.equal(payload.alreadyClaimed, false);
  assert.equal(payload.hotel.name, "Ocean View");
});

test("claimed verification codes only remain reusable for the same current user", () => {
  const claimedByCurrentUser = buildPartnerVerificationPayload(
    {
      code: "VRF4821K",
      hotel: {
        hotel_id: 91,
      },
      claim: {
        id: 7,
        user_id: 42,
        claim_status: "TRIAL_ACTIVE",
      },
    },
    { currentUserId: 42 },
  );

  const claimedByAnotherUser = buildPartnerVerificationPayload(
    {
      code: "VRF4821K",
      hotel: {
        hotel_id: 91,
      },
      claim: {
        id: 7,
        user_id: 42,
        claim_status: "TRIAL_ACTIVE",
      },
    },
    { currentUserId: 8 },
  );

  assert.equal(claimedByCurrentUser.canActivate, true);
  assert.equal(claimedByCurrentUser.claimedByCurrentUser, true);
  assert.equal(claimedByCurrentUser.status, "CLAIMED_BY_ME");
  assert.equal(claimedByAnotherUser.canActivate, false);
  assert.equal(claimedByAnotherUser.claimedByCurrentUser, false);
  assert.equal(claimedByAnotherUser.status, "CLAIMED");
});
