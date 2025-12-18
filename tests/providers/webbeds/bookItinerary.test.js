import test from "node:test"
import assert from "node:assert/strict"

import {
  buildBookItineraryPayload,
  mapBookItineraryResponse,
} from "../../../src/providers/webbeds/bookItinerary.js"

test("buildBookItineraryPayload includes testPricesAndAllocation for confirm=preauth", () => {
  const payload = buildBookItineraryPayload({
    bookingCode: "1416145493",
    bookingType: 2,
    confirm: "preauth",
    sendCommunicationTo: "test@mail.com",
    payment: {
      paymentMethod: "CC_PAYMENT_COMMISSIONABLE",
      usedCredit: 0,
      creditCardCharge: 100.5,
      token: "RezToken",
      cardHolderName: "John Doe",
      creditCardType: 100,
      avsDetails: {
        avsFirstName: "John",
        avsLastName: "Doe",
        avsAddress: "Test St 123",
        avsZip: "00000",
        avsCountry: "US",
        avsCity: "NYC",
        avsEmail: "test@mail.com",
        avsPhone: "0000000000",
      },
      devicePayload: "devicePayload",
      endUserIPAddress: "1.2.3.4",
    },
    services: [
      {
        returnedServiceCode: "987654",
        testPrice: 100.5,
        allocationDetails: "ALLOC_TOKEN",
      },
    ],
  })

  assert.equal(payload.bookingDetails.confirm, "preauth")
  assert.ok(payload.bookingDetails.testPricesAndAllocation)
  assert.equal(
    payload.bookingDetails.testPricesAndAllocation.service[0]["@referencenumber"],
    "987654",
  )
  assert.equal(payload.bookingDetails.creditCardPaymentDetails.devicePayload, "devicePayload")
  assert.equal(payload.bookingDetails.creditCardPaymentDetails.endUserIPv4Address, "1.2.3.4")
})

test("buildBookItineraryPayload uses authorisationId and strips device fields for confirm=yes", () => {
  const payload = buildBookItineraryPayload({
    bookingCode: "1416145493",
    bookingType: 2,
    confirm: "yes",
    payment: {
      paymentMethod: "CC_PAYMENT_COMMISSIONABLE",
      usedCredit: 0,
      creditCardCharge: 100.5,
      orderCode: "ORDER123",
      authorisationId: "AUTH123",
      devicePayload: "shouldBeStripped",
      endUserIPAddress: "9.9.9.9",
    },
    services: [
      {
        referenceNumber: "987654",
        testPrice: 100.5,
        allocationDetails: "ALLOC_TOKEN",
      },
    ],
  })

  assert.equal(payload.bookingDetails.confirm, "yes")
  assert.ok(payload.bookingDetails.testPricesAndAllocation)
  // orderCode / authorisationId ahora van al nivel de creditCardPaymentDetails (no dentro de creditCardDetails)
  assert.equal(payload.bookingDetails.creditCardPaymentDetails.orderCode, "ORDER123")
  assert.equal(payload.bookingDetails.creditCardPaymentDetails.authorisationId, "AUTH123")
  assert.ok(!("devicePayload" in payload.bookingDetails.creditCardPaymentDetails))
  assert.ok(!("endUserIPv4Address" in payload.bookingDetails.creditCardPaymentDetails))
})

test("mapBookItineraryResponse exposes threeDSData and aliases authorizationId", () => {
  const result = {
    currencyShort: "USD",
    successful: "TRUE",
    returnedCode: "1416145493",
    threeDSData: {
      initiate3DS: "1",
      token: "3DS_TOKEN",
      status: "CHALLENGE_PENDING",
      orderCode: "ORDER123",
      authorisationId: "AUTH123",
    },
    bookings: {
      booking: {
        bookingCode: "987654",
        bookingReferenceNumber: "REF",
        bookingStatus: "1",
        price: { formatted: "100.50" },
        servicePrice: { formatted: "100.50" },
        mealsPrice: { formatted: "0.00" },
        voucher: "VOUCHER",
        paymentGuaranteedBy: "CC",
        currency: "520",
        type: "hotel",
        emergencyContacts: { emergencyContact: [] },
      },
    },
    product: { allocationDetails: "ALLOC_TOKEN" },
  }

  const mapped = mapBookItineraryResponse(result)
  assert.equal(mapped.orderCode, "ORDER123")
  assert.equal(mapped.authorisationId, "AUTH123")
  assert.equal(mapped.authorizationId, "AUTH123")
  assert.equal(mapped.threeDSData.orderCode, "ORDER123")
  assert.equal(mapped.threeDSData.authorisationId, "AUTH123")
  assert.equal(mapped.threeDSData.initiate3DS, "1")
  assert.equal(mapped.threeDSData.status, "CHALLENGE_PENDING")
  assert.equal(mapped.successful, true)
  assert.equal(mapped.bookings.length, 1)
})
