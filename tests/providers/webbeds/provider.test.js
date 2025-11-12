import test from "node:test"
import assert from "node:assert/strict"

process.env.WEBBEDS_USERNAME = "test-user"
process.env.WEBBEDS_PASSWORD_MD5 = "1457ba5e18a5972ec0e78e7b34e8e50c"
process.env.WEBBEDS_COMPANY_ID = "2266975"
process.env.WEBBEDS_HOST = "https://example.com"

if (!process.env.DB_NAME) process.env.DB_NAME = "insider_test"
if (!process.env.DB_USER) process.env.DB_USER = "insider"
if (!process.env.DB_PASSWORD) process.env.DB_PASSWORD = "secret"
if (!process.env.DB_HOST) process.env.DB_HOST = "localhost"
if (!process.env.DB_DIALECT) process.env.DB_DIALECT = "postgres"

const { WebbedsProvider } = await import("../../../src/providers/webbeds/provider.js")
const modelsModule = await import("../../../src/models/index.js")
const models = modelsModule.default

const createResponseMock = () => {
  const payloads = []
  return {
    payloads,
    json(data) {
      payloads.push(data)
      return data
    },
  }
}

test("WebbedsProvider.search sanitizes numeric codes and forwards payload", async () => {
  const captured = {}
  const fakeClient = {
    async send(command, payload, options) {
      captured.command = command
      captured.payload = payload
      captured.options = options
      return { result: { hotels: { hotel: [] } } }
    },
  }

  const provider = new WebbedsProvider({ client: fakeClient })
  const res = createResponseMock()
  const req = {
    query: {
      checkIn: "2025-12-01",
      checkOut: "2025-12-05",
      hotelIds: "30694,30674",
      passengerNationality: "ES",
      passengerCountryOfResidence: "",
      currency: "520",
      occupancies: "2|0",
    },
    user: {
      countryCode: "999",
    },
  }

  const originalFindAll = models.WebbedsHotel.findAll
  models.WebbedsHotel.findAll = async () => []

  try {
    await provider.search(req, res, (error) => {
      if (error) throw error
    })
  } finally {
    models.WebbedsHotel.findAll = originalFindAll
  }

  assert.equal(captured.command, "searchhotels")
  const [room] = captured.payload.bookingDetails.rooms.room
  assert.equal(room.passengerNationality, "604")
  assert.equal(room.passengerCountryOfResidence, "604")
  assert.deepEqual(
    captured.payload.return.filters["c:condition"]["a:condition"][0].fieldValues.fieldValue,
    ["30694", "30674"],
  )
  assert.deepEqual(res.payloads[0], [])
})

test("WebbedsProvider.search forwards builder errors to next()", async () => {
  const provider = new WebbedsProvider({
    client: {
      async send() {
        return { result: { hotels: { hotel: [] } } }
      },
    },
  })

  let receivedError = null
  const next = (error) => {
    receivedError = error
  }

  await provider.search({ query: {} }, createResponseMock(), next)

  assert.ok(receivedError instanceof Error)
  assert.match(receivedError.message, /requires valid checkIn and checkOut dates/)
})

test("WebbedsProvider.search batches hotelIds when mode=hotelIds", async () => {
  const capturedPayloads = []
  const fakeClient = {
    async send(command, payload) {
      capturedPayloads.push(payload)
      return { result: { hotels: { hotel: [] } } }
    },
  }

  const provider = new WebbedsProvider({ client: fakeClient })
  const res = createResponseMock()
  const req = {
    query: {
      mode: "hotelIds",
      checkIn: "2025-12-01",
      checkOut: "2025-12-05",
      cityCode: "364",
      currency: "520",
      occupancies: "2|0",
    },
  }

  const originalFindAll = models.WebbedsHotel.findAll
  models.WebbedsHotel.findAll = async () =>
    Array.from({ length: 55 }, (_, index) => ({ hotel_id: 1000 + index }))

  try {
    await provider.search(req, res, (error) => {
      if (error) throw error
    })
  } finally {
    models.WebbedsHotel.findAll = originalFindAll
  }

  assert.equal(capturedPayloads.length, 2)
  const firstPayload = capturedPayloads[0]
  const secondPayload = capturedPayloads[1]
  const firstFieldValues =
    firstPayload.return.filters["c:condition"]["a:condition"][0].fieldValues.fieldValue
  const secondFieldValues =
    secondPayload.return.filters["c:condition"]["a:condition"][0].fieldValues.fieldValue

  assert.equal(firstFieldValues.length, 50)
  assert.equal(secondFieldValues.length, 5)
  assert.equal(firstPayload.return.filters.city, "364")
  assert.equal(secondPayload.return.filters.city, "364")
  assert.deepEqual(res.payloads[0], [])
})
