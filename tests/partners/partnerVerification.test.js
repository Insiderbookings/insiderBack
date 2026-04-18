import test from "node:test";
import assert from "node:assert/strict";

import {
  PARTNER_VERIFICATION_CODE_PATTERN,
  buildPartnerVerificationPayload,
  normalizePartnerVerificationCodeInput,
} from "../../src/services/partnerVerification.service.js";

test("normalizes hotel verification ids from user-entered formatting", () => {
  assert.equal(normalizePartnerVerificationCodeInput(" hotel-001234 "), "001234");
});

test("hotel ids are validated as numeric verification codes", () => {
  assert.match("123456", PARTNER_VERIFICATION_CODE_PATTERN);
  assert.doesNotMatch("VRF1234A", PARTNER_VERIFICATION_CODE_PATTERN);
});

test("active unused hotel ids can activate the partner flow", () => {
  const payload = buildPartnerVerificationPayload({
    code: "88",
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
      code: "91",
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
      code: "91",
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
  assert.equal(claimedByAnotherUser.canActivate, false);
  assert.equal(claimedByAnotherUser.claimedByCurrentUser, false);
});
