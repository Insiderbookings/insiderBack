import test from "node:test"
import assert from "node:assert/strict"

import { buildSearchHotelsPayload, mapSearchHotelsResponse } from "../../../src/providers/webbeds/searchHotels.js"

test("buildSearchHotelsPayload requires checkIn and checkOut dates", () => {
  assert.throws(
    () =>
      buildSearchHotelsPayload({
        checkIn: "2025-12-01",
      }),
    /requires valid checkIn and checkOut dates/,
  )
})

test("buildSearchHotelsPayload builds rooms, defaults, and filters correctly", () => {
  const { payload } = buildSearchHotelsPayload({
    checkIn: "2025-12-01",
    checkOut: "2025-12-05",
    occupancies: "3|5-7",
    cityCode: "364",
    includeNoPrice: true,
    rateBasis: "-1",
    advancedConditions: [
      {
        fieldName: "chain",
        fieldTest: "in",
        fieldValues: ["2019", "2020"],
      },
    ],
  })

  assert.equal(payload.bookingDetails.currency, "520")
  assert.equal(payload.bookingDetails.fromDate, "2025-12-01")
  assert.equal(payload.bookingDetails.toDate, "2025-12-05")
  assert.equal(payload.bookingDetails.rooms["@no"], "1")

  const [room] = payload.bookingDetails.rooms.room
  assert.equal(room.adultsCode, "3")
  assert.equal(room.children["@no"], "2")
  assert.deepEqual(
    room.children.child.map((child) => child["#"]),
    ["5", "7"],
  )
  assert.equal(room.rateBasis, "-1")

  const { filters } = payload.return
  assert.equal(filters.city, "364")
  assert.equal(filters.noPrice, "true")
  assert.ok(filters["c:condition"])
  assert.deepEqual(filters["c:condition"]["a:condition"][0], {
    fieldName: "chain",
    fieldTest: "in",
    fieldValues: {
      fieldValue: ["2019", "2020"],
    },
  })
  assert.ok(!("getRooms" in payload.return))
})

test("buildSearchHotelsPayload falls back to country filters when no city provided", () => {
  const { payload } = buildSearchHotelsPayload({
    checkIn: "2025-12-01",
    checkOut: "2025-12-05",
    countryCode: "178",
    occupancies: "2|0",
  })

  assert.equal(payload.return.filters.country, "178")
  assert.ok(!payload.return.filters.city)
})

test("mapSearchHotelsResponse propagates minStay metadata when provided", () => {
  const result = {
    currencyShort: "520",
    hotels: {
      hotel: [
        {
          "@_hotelid": "123",
          hotelName: "Demo Hotel",
          rooms: {
            room: {
              roomType: {
                "@_roomtypecode": "ABC",
                name: "Room ABC",
                rateBases: {
                  rateBasis: {
                    "@_id": "999",
                    total: "100.50",
                    minStay: "3",
                    dateApplyMinStay: "2025-11-10",
                    rateType: {
                      "@_currencyid": "520",
                    },
                    cancellationRules: { rule: [] },
                  },
                },
              },
            },
          },
        },
      ],
    },
  }

  const [option] = mapSearchHotelsResponse(result)
  assert.equal(option.metadata.minStay, 3)
  assert.equal(option.metadata.dateApplyMinStay, "2025-11-10")
  assert.equal(option.rooms[0].minStay, 3)
  assert.equal(option.rooms[0].dateApplyMinStay, "2025-11-10")
})
