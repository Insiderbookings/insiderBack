import test from "node:test"
import assert from "node:assert/strict"
import {
  getDefaultMailFromEmail,
  getDefaultMailFromName,
  resolveMailFrom,
} from "../../src/helpers/mailFrom.js"

const ORIGINAL_ENV = {
  MAIL_FROM: process.env.MAIL_FROM,
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME,
  MAIL_FROM_EMAIL: process.env.MAIL_FROM_EMAIL,
  SMTP_USER: process.env.SMTP_USER,
}

function resetEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value == null) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

test.afterEach(() => {
  resetEnv()
})

test.after(() => {
  resetEnv()
})

test("uses MAIL_FROM_NAME and MAIL_FROM_EMAIL when present", () => {
  process.env.MAIL_FROM_NAME = "Insider Ops"
  process.env.MAIL_FROM_EMAIL = "ops@insiderbookings.com"
  delete process.env.MAIL_FROM
  delete process.env.SMTP_USER

  assert.equal(getDefaultMailFromName(), "Insider Ops")
  assert.equal(getDefaultMailFromEmail(), "ops@insiderbookings.com")
  assert.equal(resolveMailFrom(), "Insider Ops <ops@insiderbookings.com>")
})

test("falls back to legacy MAIL_FROM when it already includes a formatted mailbox", () => {
  process.env.MAIL_FROM = "Support Team <support@insiderbookings.com>"
  delete process.env.MAIL_FROM_NAME
  delete process.env.MAIL_FROM_EMAIL
  delete process.env.SMTP_USER

  assert.equal(getDefaultMailFromName(), "Support Team")
  assert.equal(getDefaultMailFromEmail(), "support@insiderbookings.com")
  assert.equal(resolveMailFrom(), "Support Team <support@insiderbookings.com>")
})

test("formats a plain email with the resolved fallback name", () => {
  process.env.MAIL_FROM_NAME = "Insider Bookings"
  process.env.MAIL_FROM_EMAIL = "no-reply@insiderbookings.com"
  delete process.env.MAIL_FROM
  delete process.env.SMTP_USER

  assert.equal(
    resolveMailFrom("reservations@insiderbookings.com", { fallbackName: "Hotel California" }),
    "Hotel California <reservations@insiderbookings.com>",
  )
  assert.equal(resolveMailFrom(), "Insider Bookings <no-reply@insiderbookings.com>")
})
