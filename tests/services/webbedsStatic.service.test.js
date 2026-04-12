import test from "node:test"
import assert from "node:assert/strict"

if (!process.env.DB_NAME) process.env.DB_NAME = "insider_test"
if (!process.env.DB_USER) process.env.DB_USER = "insider"
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = "secret"
if (!process.env.DB_HOST) process.env.DB_HOST = "localhost"
if (!process.env.DB_DIALECT) process.env.DB_DIALECT = "postgres"

const { __testables } = await import("../../src/services/webbedsStatic.service.js")

test("buildHotelUpsertPayload sanitizes invalid numeric values before upsert", () => {
  const hotel = {
    "@_hotelid": "5715045",
    hotelName: "Hilton The Palm",
    cityCode: "364",
    cityName: "DUBAI",
    countryCode: "6",
    countryName: "UNITED ARAB EMIRATES",
    regionName: "GCC",
    regionCode: "14",
    rating: "563",
    chain: "2019",
    priority: "12",
    lastUpdated: "NaN",
    geoPoint: {
      lat: "NaN",
      lng: "55.14730697",
    },
  }

  const preparedHotel = __testables.buildHotelUpsertPayload({
    hotel,
    fallbackCityCode: "364",
    hotelChainCodes: new Set([2019]),
    hotelClassificationCodes: new Set([563]),
  })

  assert.ok(preparedHotel)
  assert.equal(preparedHotel.hotelId, 5715045)
  assert.equal(preparedHotel.payload.city_code, 364)
  assert.equal(preparedHotel.payload.country_code, 6)
  assert.equal(preparedHotel.payload.priority, 12)
  assert.equal(preparedHotel.payload.last_updated, null)
  assert.equal(preparedHotel.payload.lat, null)
  assert.equal(preparedHotel.payload.lng, 55.14730697)
  assert.equal(preparedHotel.payload.chain_code, 2019)
  assert.equal(preparedHotel.payload.classification_code, 563)
})

test("buildHotelUpsertPayload returns null when hotel id is missing", () => {
  const preparedHotel = __testables.buildHotelUpsertPayload({
    hotel: {
      hotelName: "Missing Id Hotel",
    },
    fallbackCityCode: "364",
    hotelChainCodes: new Set(),
    hotelClassificationCodes: new Set(),
  })

  assert.equal(preparedHotel, null)
})
