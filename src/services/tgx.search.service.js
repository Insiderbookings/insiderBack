/*********************************************************************************************
 * src/services/tgx/search.service.js
 * Wrapper para la operación Search de Hotel‑X
 * – Compatible con las credenciales demo (jun‑2025).
 * – Incluye modo DEBUG_TGX para ver variables y respuesta/errores en consola.
 *********************************************************************************************/

import { GraphQLClient } from "graphql-request"
import gql from "graphql-tag"

const DEBUG = process.env.DEBUG_TGX === "true"

/* ────────────────────────────── 1. Cliente GraphQL reutilizable ────────────────────────────── */
const tgxClient = new GraphQLClient(
  // Usa la URL de la variable de entorno o, por defecto, la oficial demo
  process.env.TGX_ENDPOINT ?? "https://api.travelgate.com",
  {
    headers: {
      Authorization: `Apikey ${process.env.TGX_KEY}`,
      "Accept-Encoding": "gzip",
      Connection: "keep-alive",
    },
    timeout: 30_000, // ms
  },
)

/* ────────────────────────────── 2. Query Search (AST) - COMPLETA ────────────────────────────── */
const SEARCH_Q = gql`
  query SearchTGX(
    $criteria: HotelCriteriaSearchInput!
    $settings: HotelSettingsInput!
    $filter: HotelXFilterSearchInput
  ) {
    hotelX {
      search(
        criteria: $criteria
        settings: $settings
        filterSearch: $filter
      ) {
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
            paxes {
              age
            }
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
                exchange {
                  currency
                  rate
                }
              }
              breakdown {
                start
                end
                price {
                  currency
                  binding
                  net
                  gross
                  exchange {
                    currency
                    rate
                  }
                  minimumSellingPrice
                }
              }
            }
            beds {
              type
              count
            }
            ratePlans {
              start
              end
              code
              name
            }
            promotions {
              start
              end
              code
              name
            }
          }
          price {
            currency
            binding
            net
            gross
            exchange {
              currency
              rate
            }
            minimumSellingPrice
            markups {
              channel
              currency
              binding
              net
              gross
              exchange {
                currency
                rate
              }
              rules {
                id
                name
                type
                value
              }
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
            resort {
              code
              name
              description
            }
            price {
              currency
              binding
              net
              gross
              exchange {
                currency
                rate
              }
            }
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
              exchange {
                currency
                rate
              }
              markups {
                channel
                currency
                binding
                net
                gross
                exchange {
                  currency
                  rate
                }
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
        errors {
          code
          type
          description
        }
        warnings {
          code
          type
          description
        }
      }
    }
  }
`

/* ────────────────────────────── 3. Función de bajo nivel: Search ────────────────────────────── */
export async function searchTGX(criteria, settings, filter = null) {
  const vars = { criteria, settings, filter }

  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(SEARCH_Q, vars)

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

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
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
      option.surcharges?.map((surcharge) => ({
        code: surcharge.code,
        description: surcharge.description,
        mandatory: surcharge.mandatory,
        price: surcharge.price?.net,
        currency: surcharge.price?.currency,
      })) ?? [],
  }))
}
