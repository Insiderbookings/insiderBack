import test from "node:test"
import assert from "node:assert/strict"

import { resolveEffectiveSearchIntent } from "../../src/utils/hotelSearchIntent.js"

test("keeps explicit city searches as city even when a hotel-like signal exists", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "city",
    rawSearchMode: "city",
    resolvedCityCode: "364",
    hasStrongHotelNameSignal: true,
  })

  assert.equal(intent, "city")
})

test("keeps resolved city searches as city when filters are present but no explicit hotel signal exists", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "mixed",
    rawSearchMode: "hotelids",
    resolvedCityCode: "364",
    manualHotelName: null,
    hasStrongHotelNameSignal: true,
  })

  assert.equal(intent, "city")
})

test("preserves explicit hotel searches", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "hotel",
    rawSearchMode: "hotelids",
    resolvedCityCode: "364",
    hasStrongHotelNameSignal: false,
  })

  assert.equal(intent, "hotel")
})

test("allows ambiguous searches without city anchor to resolve as hotel", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "mixed",
    rawSearchMode: "hotelids",
    resolvedCityCode: null,
    hasStrongHotelNameSignal: true,
  })

  assert.equal(intent, "hotel")
})

test("keeps ambiguous searches with resolved city anchored to city", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "mixed",
    rawSearchMode: "hotelids",
    resolvedCityCode: "8419",
    hasStrongHotelNameSignal: true,
  })

  assert.equal(intent, "city")
})

test("preserves landmark intent", () => {
  const intent = resolveEffectiveSearchIntent({
    requestedIntent: "landmark",
    rawSearchMode: "hotelids",
    resolvedCityCode: "8419",
    hasStrongHotelNameSignal: true,
  })

  assert.equal(intent, "landmark")
})
