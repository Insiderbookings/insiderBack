import test from "node:test";
import assert from "node:assert/strict";

import { resolvePreauthPaymentRuntime } from "../../../src/utils/webbedsPaymentRuntime.js";

test("resolvePreauthPaymentRuntime forces env payload and ip when WEBBEDS_PAYMENT_DEV=true", async () => {
  const runtime = await resolvePreauthPaymentRuntime({
    body: {
      devicePayload: "request-payload",
      endUserIPAddress: "8.8.8.8",
    },
    req: {
      headers: { "x-forwarded-for": "9.9.9.9" },
      ip: "10.0.0.2",
    },
    env: {
      WEBBEDS_PAYMENT_DEV: "true",
      WEBBEDS_DEVICE_PAYLOAD: "env-payload",
      WEBBEDS_DEFAULT_IP: "127.0.0.1",
    },
  });

  assert.deepEqual(runtime, {
    devicePayload: "env-payload",
    devicePayloadSource: "dev-env",
    endUserIPAddress: "127.0.0.1",
    endUserIPAddressSource: "dev-env",
  });
});

test("resolvePreauthPaymentRuntime fails fast when WEBBEDS_PAYMENT_DEV=true and env payload is missing", async () => {
  await assert.rejects(
    resolvePreauthPaymentRuntime({
      env: {
        WEBBEDS_PAYMENT_DEV: "true",
        WEBBEDS_DEFAULT_IP: "127.0.0.1",
      },
    }),
    (error) => {
      assert.equal(error?.code, "MISSING_WEBBEDS_DEVICE_PAYLOAD");
      assert.equal(error?.status, 503);
      return true;
    },
  );
});
