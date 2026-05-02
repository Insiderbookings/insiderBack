import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlausiblePhoneInput,
  maskPhone,
  normalizePhoneE164,
  resolveStoredPhone,
  samePhoneIdentity,
} from "./phone.js";

const tests = [
  {
    name: "normalizePhoneE164 keeps valid international numbers canonical",
    run: () => {
      assert.equal(normalizePhoneE164("+54 9 11 1234 5678"), "+5491112345678");
      assert.equal(normalizePhoneE164("(+1) 415-555-2671"), "+14155552671");
      assert.equal(normalizePhoneE164("4155552671"), null);
    },
  },
  {
    name: "isPlausiblePhoneInput accepts user input before strict verification",
    run: () => {
      assert.equal(isPlausiblePhoneInput("+54 9 11 1234 5678"), true);
      assert.equal(isPlausiblePhoneInput("415-555-2671"), true);
      assert.equal(isPlausiblePhoneInput("abc"), false);
    },
  },
  {
    name: "resolveStoredPhone prefers canonical E164 values when possible",
    run: () => {
      assert.deepEqual(resolveStoredPhone("+54 9 11 1234 5678"), {
        phone: "+5491112345678",
        phoneE164: "+5491112345678",
      });
      assert.deepEqual(resolveStoredPhone("415-555-2671"), {
        phone: "415-555-2671",
        phoneE164: null,
      });
    },
  },
  {
    name: "samePhoneIdentity compares by canonical phone when possible",
    run: () => {
      assert.equal(samePhoneIdentity("+1 415-555-2671", "+14155552671"), true);
      assert.equal(samePhoneIdentity("+14155552671", "+5491112345678"), false);
      assert.equal(samePhoneIdentity("415-555-2671", "415-555-2671"), true);
    },
  },
  {
    name: "maskPhone preserves only a small visible prefix and suffix",
    run: () => {
      assert.equal(maskPhone("+5491112345678"), "+54******78");
      assert.equal(maskPhone(""), "your phone number");
    },
  },
];

for (const testCase of tests) {
  test(testCase.name, testCase.run);
}
