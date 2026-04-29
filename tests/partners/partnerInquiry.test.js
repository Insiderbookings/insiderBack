import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicPartnerInquiryPayload,
  resolvePartnerInquiryStatus,
} from "../../src/services/partnerInquiry.service.js";

test("public inquiry payload is only exposed when the hotel is truly ready", () => {
  const payload = buildPublicPartnerInquiryPayload({
    claim: {
      claim_status: "SUBSCRIBED",
    },
    profile: {
      inquiry_enabled: true,
      inquiry_email: "stay@hotel.example",
      inquiry_notes: "We reply during local business hours.",
    },
    partnerProgram: {
      capabilities: {
        bookingInquiry: true,
      },
    },
  });

  assert.deepEqual(payload, {
    enabled: true,
    ctaLabel: "Send inquiry",
    notes: "We reply during local business hours.",
  });
});

test("inquiry status stays in needs setup until delivery routing exists", () => {
  const status = resolvePartnerInquiryStatus({
    claim: {
      claim_status: "SUBSCRIBED",
    },
    profile: {
      inquiry_enabled: true,
    },
    partnerProgram: {
      capabilities: {
        bookingInquiry: true,
      },
    },
  });

  assert.equal(status.state, "missing_setup");
  assert.equal(status.label, "Needs setup");
  assert.equal(status.ready, false);
});

test("delivery failures override the ready state for dashboard visibility", () => {
  const status = resolvePartnerInquiryStatus({
    claim: {
      claim_status: "SUBSCRIBED",
    },
    profile: {
      inquiry_enabled: true,
      inquiry_email: "stay@hotel.example",
    },
    partnerProgram: {
      capabilities: {
        bookingInquiry: true,
      },
    },
    latestInquiry: {
      delivery_status: "FAILED",
      error_message: "Mailbox unavailable",
    },
    metrics: {
      total: 4,
      last30Days: 2,
    },
  });

  assert.equal(status.state, "delivery_issue");
  assert.equal(status.label, "Delivery issue");
  assert.equal(status.detail, "Mailbox unavailable");
  assert.equal(status.metrics.total, 4);
  assert.equal(status.metrics.last30Days, 2);
});
