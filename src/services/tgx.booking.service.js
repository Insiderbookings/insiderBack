/* ────────────────────────────────────────────────   TravelgateX — Quote · Book · Cancel services   ──────────────────────────────────────────────── */
import { GraphQLClient, gql } from "graphql-request"

/* ---------- helper: client singleton ---------- */
let _client
function tgxClient() {
  if (_client) return _client
  _client = new GraphQLClient(process.env.TGX_ENDPOINT, {
    headers: {
      Authorization: `ApiKey ${process.env.TGX_KEY}`,
      "Accept-Encoding": "gzip",
      Connection: "keep-alive",
    },
  })
  return _client
}

/* ---------- GraphQL fragments ---------- */
// Adjusting PRICE_FRAGMENT based on new errors
const PRICE_FRAGMENT = `
price {
  currency
  net
  # Removed 'amount' and 'public' as they seem to be causing issues
}
cancelPolicy {
  refundable
  # Removed 'from', 'amount', 'currency' as they seem to be causing issues
}`

/* ---------- QUOTE ---------------------- */
const QUOTE_Q = gql`
query ($input: HotelCriteriaQuoteInput!, $settings: HotelSettingsInput!) {
  hotelX {
    quote(criteria: $input, settings: $settings) {
      # Removed 'stats' field as it requires subfields and a 'token' argument
      optionQuote {
        optionRefId
        ${PRICE_FRAGMENT}
        rooms {
          code # Changed from roomCode based on error hint
          # Removed boardCode as it was causing an error
          refundable
        }
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
}`

export async function quoteTGX(rateKey, settings) {
  const vars = {
    input: { optionRefId: rateKey }, // Reverted to input object for criteria
    settings,
  }
  console.log("🔍 TGX Quote request:", { rateKey, settings })
  try {
    const data = await tgxClient().request(QUOTE_Q, vars)
    console.log("✅ TGX Quote response:", data)
    if (data.hotelX.quote.errors && data.hotelX.quote.errors.length > 0) {
      throw new Error(`Quote error: ${data.hotelX.quote.errors[0].description}`)
    }
    return data.hotelX.quote.optionQuote
  } catch (error) {
    console.error("❌ TGX Quote error:", error)
    throw error
  }
}

/* ---------- BOOK ----------------------- */
const BOOK_MUT = gql`
  mutation ($input: HotelBookInput!, $settings: HotelSettingsInput!) {
    hotelX {
      book(input: $input, settings: $settings) {
        booking {
          bookingID
          status
          supplierReference
          reference {
            bookingID
            client
            supplier
            hotel
          }
          ${PRICE_FRAGMENT}
          holder {
            name
            surname
          }
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
          hotel {
            hotelCode
            hotelName
            bookingDate
            start
            end
            boardCode
            occupancies {
              id
              paxes {
                age
              }
            }
            rooms {
              code
              description
              occupancyRefId
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

export async function bookTGX(input, settings) {
  const vars = { input, settings }
  console.log("🎯 TGX Book request:", { input, settings })
  try {
    const data = await tgxClient().request(BOOK_MUT, vars)
    console.log("✅ TGX Book response:", data)
    if (data.hotelX.book.errors && data.hotelX.book.errors.length > 0) {
      throw new Error(`Booking error: ${data.hotelX.book.errors[0].description}`)
    }
    return data.hotelX.book.booking // Retornar el objeto booking
  } catch (error) {
    console.error("❌ TGX Book error:", error)
    throw error
  }
}

/* ---------- CANCEL --------------------- */
const CANCEL_MUT = gql`
mutation ($input: HotelXCancelInput!, $settings: HotelSettingsInput!) {
  hotelX {
    cancel(input: $input, settings: $settings) {
      bookingID
      status
      supplierReference
      refund {
        amount
        currency
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
}`

/**
 * Cancel by bookingID (from Book response)
 * or by { accessCode, hotelCode, reference }
 */
export async function cancelTGX(bookingIDOrObj, settings) {
  const input = typeof bookingIDOrObj === "string" ? { bookingID: bookingIDOrObj } : bookingIDOrObj // { accessCode, hotelCode, reference }
  const vars = { input, settings }
  console.log("🚫 TGX Cancel request:", { input, settings })
  try {
    const data = await tgxClient().request(CANCEL_MUT, vars)
    console.log("✅ TGX Cancel response:", data)
    if (data.hotelX.cancel.errors && data.hotelX.cancel.errors.length > 0) {
      throw new Error(`Cancel error: ${data.hotelX.cancel.errors[0].description}`)
    }
    return data.hotelX.cancel
  } catch (error) {
    console.error("❌ TGX Cancel error:", error)
    throw error
  }
}
