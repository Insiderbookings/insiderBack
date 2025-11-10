import { createHash } from "crypto"
import { HotelProvider } from "../hotelProvider.js"
import { createWebbedsClient, buildEnvelope } from "./client.js"
import { getWebbedsConfig } from "./config.js"
import { buildSearchHotelsPayload, mapSearchHotelsResponse } from "./searchHotels.js"

const sharedClient = (() => {
  try {
    const config = getWebbedsConfig()
    return createWebbedsClient(config)
  } catch (error) {
    console.warn("[webbeds] client not initialized:", error.message)
    return null
  }
})()

export class WebbedsProvider extends HotelProvider {
  constructor({ client = sharedClient } = {}) {
    super()
    if (!client) {
      throw new Error("WebBeds client is not configured")
    }
    this.client = client
  }

  getRequestId(req) {
    return req?.id || req?.headers?.["x-request-id"]
  }

  async search(req, res, next) {
    try {
      const {
        checkIn,
        checkOut,
        occupancies,
        currency,
        cityCode,
        countryCode,
        nationality = req?.user?.country || "ES",
        residence = req?.user?.country || "ES",
       rateBasis = "-1",
      } = req.query

      const {
        payload,
        requestAttributes,
      } = buildSearchHotelsPayload({
        checkIn,
        checkOut,
        currency,
        occupancies,
        nationality,
        residence,
        rateBasis,
        cityCode,
        countryCode,
        includeRooms: req.query.getRooms === "true",
        advancedConditions: req.query.hotelIds
          ? [
              {
                fieldName: "hotelId",
                fieldTest: "in",
                fieldValues: String(req.query.hotelIds)
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            ]
          : undefined,
        includeFields: req.query.fields
          ? String(req.query.fields)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined,
        includeRoomFields: req.query.roomFields
          ? String(req.query.roomFields)
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined,
        includeNoPrice: req.query.noPrice === "true",
        debug: req.query.debug ?? undefined,
      })

      const config = getWebbedsConfig()
      const passwordHash =
        config.passwordMd5 ||
        (config.password
          ? createHash("md5").update(config.password).digest("hex")
          : null)

      const requestXml = buildEnvelope({
        username: config.username,
        passwordMd5: passwordHash,
        companyCode: config.companyCode,
        command: "searchhotels",
        product: "hotel",
        payload,
        requestAttributes,
      })

      console.log("[webbeds] --- request build start ---")
      console.log("[webbeds] payload:", JSON.stringify(payload, null, 2))
      console.log("[webbeds] request attributes:", requestAttributes)
      console.log("[webbeds] request XML:", requestXml)
      console.log("[webbeds] --- request build end ---")

      const { result } = await this.client.send("searchhotels", payload, {
        requestId: this.getRequestId(req),
        requestAttributes,
      })

      const options = mapSearchHotelsResponse(result)
      return res.json(options)
    } catch (error) {
      if (error.name === "WebbedsError") {
        console.error("[webbeds] search error", {
          command: error.command,
          code: error.code,
          details: error.details,
          extra: error.extraDetails,
          metadata: error.metadata,
          requestXml: error.requestXml,
        })
      } else {
        console.error("[webbeds] unexpected error", error)
      }
      return next(error)
    }
  }
}
