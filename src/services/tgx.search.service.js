/*********************************************************************************************
 * src/services/tgx/search.service.js
 * Search de Hotel-X con soporte de filtros y capturas (certificación).
 *********************************************************************************************/

import { GraphQLClient } from "graphql-request"
import gql from "graphql-tag"
import { requestWithCapture } from "./tgx.capture.js"

const DEBUG = process.env.DEBUG_TGX === "true"
const CERT_MODE = process.env.TGX_CERT_MODE === "true"

/* ── 1. Cliente GraphQL ────────────────────────────────────────────────────────────────────── */
const tgxClient = new GraphQLClient(
  process.env.TGX_ENDPOINT ?? "https://api.travelgate.com",
  {
    headers: {
      Authorization: `ApiKey ${process.env.TGX_KEY}`,
      "Accept-Encoding": "gzip",
      Connection: "keep-alive",
    },
    timeout: 30_000,
  },
)

/* ── 2. Query Search (AST) ─────────────────────────────────────────────────────────────────── */
const SEARCH_Q = gql`
  query SearchTGX(
    $criteria: HotelCriteriaSearchInput!
    $settings: HotelSettingsInput!
    $filter: HotelXFilterSearchInput
  ) {
    hotelX {
      search(criteria: $criteria, settings: $settings, filterSearch: $filter) {
        context
        options {
          id
          accessCode
          supplierCode
          hotelCode
          hotelName
          boardCode
          paymentType
          status
          occupancies {
            id
            paxes { age }
          }
          rooms {
            occupancyRefId
            code
            description
            refundable
            roomPrice {
              price {
                currency
                binding
                net
                gross
                exchange { currency rate }
              }
              breakdown {
                start
                end
                price {
                  currency
                  binding
                  net
                  gross
                  exchange { currency rate }
                  minimumSellingPrice
                }
              }
            }
            beds { type count }
            ratePlans { start end code name }
            promotions { start end code name }
          }
          price {
            currency
            binding
            net
            gross
            exchange { currency rate }
            minimumSellingPrice
            markups {
              channel
              currency
              binding
              net
              gross
              exchange { currency rate }
              rules { id name type value }
            }
          }
          supplements {
            start
            end
            code
            name
            description
            supplementType
            chargeType
            mandatory
            durationType
            quantity
            unit
            resort { code name description }
            price { currency binding net gross exchange { currency rate } }
          }
          surcharges {
            code
            chargeType
            description
            mandatory
            price {
              currency
              binding
              net
              gross
              exchange { currency rate }
              markups {
                channel
                currency
                binding
                net
                gross
                exchange { currency rate }
              }
            }
          }
          rateRules
          cancelPolicy {
            refundable
            cancelPenalties {
              deadline
              isCalculatedDeadline
              penaltyType
              currency
              value
            }
          }
          remarks
        }
        errors { code type description }
        warnings { code type description }
      }
    }
  }
`

/* ── 3. Low-level search ───────────────────────────────────────────────────────────────────── */
export async function searchTGX(criteria, settings, filter = null, captureLabel = undefined) {
  const vars = { criteria, settings, filter }

  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const exec = () => tgxClient.request(SEARCH_Q, vars)

    const data = CERT_MODE
      ? await requestWithCapture(
          "search",
          vars,
          exec,
          {
            doc: SEARCH_Q,
            // 🆕 si tu requestWithCapture soporta label/naming, lo usamos para nombrar rq/rs
            // Por ejemplo: rq_search_rf.json / rs_search_rf.json
            label: captureLabel
          }
        )
      : await exec()

    if (DEBUG) {
      console.debug("\n[DEBUG_TGX] ⬇︎ Respuesta:\n", JSON.stringify(data, null, 2))
    }
    return data.hotelX.search
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ── 4. Mapper para el front ───────────────────────────────────────────────────────────────── */
export function mapSearchOptions(search) {
  if (!search?.options?.length) return []
  return search.options.map((option) => ({
    rateKey: option.id,
    hotelCode: option.hotelCode,
    hotelName: option.hotelName,
    board: option.boardCode,
    paymentType: option.paymentType,
    status: option.status,
    price: option.price?.net ?? null,
    currency: option.price?.currency ?? null,
    refundable: option.rooms?.[0]?.refundable ?? null,
    rooms:
      option.rooms?.map((room) => ({
        code: room.code,
        description: room.description,
        refundable: room.refundable,
        price: room.roomPrice?.price?.net,
        currency: room.roomPrice?.price?.currency,
      })) ?? [],
    cancelPolicy: option.cancelPolicy,
    rateRules: option.rateRules,
    surcharges:
      option.surcharges?.map((s) => ({
        code: s.code,
        description: s.description,
        mandatory: s.mandatory,
        price: s.price?.net,
        currency: s.price?.currency,
      })) ?? [],
  }))
}
