// tgx.hotelList.service.js
import 'dotenv/config'
import { GraphQLClient, gql } from 'graphql-request'
import { requestWithCapture } from './tgx.capture.js'
import { setGlobalDispatcher, Agent } from 'undici'

/* ────────────────────────────────────────────────
   Flags y setup
──────────────────────────────────────────────── */
const CERT_MODE  = process.env.TGX_CERT_MODE === 'true'
const CERT_LIMIT = Number.parseInt(process.env.TGX_CERT_HOTELS_LIMIT || '5', 10)

// Keep-Alive pooling
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  // connections: 128 // descomenta si necesitás más concurrencia
}))

function makeHeaders(extra = {}) {
  const base = {
    Authorization: `ApiKey ${process.env.TGX_KEY}`,
    'Accept-Encoding': 'gzip',  // GZIP explícito
    Connection: 'keep-alive',   // Keep-Alive explícito
  }
  // GraphQL→REST (opcional, activalo con TGX_GRAPHQLX=true)
  if (process.env.TGX_GRAPHQLX === 'true') {
    base['TGX-Content-Type'] = 'graphqlx/json'
  }
  // Operation Timeout por header (opcional, definido por tu tenant/doc)
  if (process.env.TGX_OPERATION_TIMEOUT_HEADER && process.env.TGX_OPERATION_TIMEOUT_MS) {
    base[process.env.TGX_OPERATION_TIMEOUT_HEADER] = String(process.env.TGX_OPERATION_TIMEOUT_MS)
  }
  return { ...base, ...extra }
}

const client = new GraphQLClient(
  process.env.TGX_ENDPOINT || 'https://api.travelgate.com',
  { headers: makeHeaders() }
)

/* ────────────────────────────────────────────────
   Queries
   (CERT usa la “full” para que se parezca al ejemplo oficial)
──────────────────────────────────────────────── */
const HOTEL_QUERY_CERT = gql`
  query ($criteriaHotels: HotelXHotelListInput!, $token: String) {
    hotelX {
      hotels(criteria: $criteriaHotels, token: $token) {
        token
        count
        edges {
          node {
            createdAt
            updatedAt
            hotelData {
              hotelCode
              hotelName
              categoryCode
              chainCode
              location {
                address
                zipCode
                city
                country
                coordinates { latitude longitude }
                closestDestination {
                  code
                  available
                  texts { text language }
                  type
                  parent
                }
              }
              contact {
                email
                telephone
                fax
                web
              }
              propertyType { propertyCode name }
              descriptions { type texts { language text } }
              medias { code url }
              rooms {
                edges {
                  node {
                    code
                    roomData {
                      code
                      roomCode
                      allAmenities {
                        edges { node { amenityData { code amenityCode } } }
                      }
                    }
                  }
                }
              }
              allAmenities {
                edges { node { amenityData { code amenityCode } } }
              }
            }
          }
        }
      }
    }
  }
`

// “Full” también para modo normal (idéntica a CERT para unificar la forma)
const HOTEL_QUERY_FULL = gql`
  query ($criteriaHotels: HotelXHotelListInput!, $token: String) {
    hotelX {
      hotels(criteria: $criteriaHotels, token: $token) {
        token
        count
        edges {
          node {
            createdAt
            updatedAt
            hotelData {
              hotelCode
              hotelName
              categoryCode
              chainCode
              location {
                address
                zipCode
                city
                country
                coordinates { latitude longitude }
                closestDestination {
                  code
                  available
                  texts { text language }
                  type
                  parent
                }
              }
              contact {
                email
                telephone
                fax
                web
              }
              propertyType { propertyCode name }
              descriptions { type texts { language text } }
              medias { code url }
              rooms {
                edges {
                  node {
                    code
                    roomData {
                      code
                      roomCode
                      allAmenities {
                        edges { node { amenityData { code amenityCode } } }
                      }
                    }
                  }
                }
              }
              allAmenities {
                edges { node { amenityData { code amenityCode } } }
              }
            }
          }
        }
      }
    }
  }
`

/* ────────────────────────────────────────────────
   Service
──────────────────────────────────────────────── */
export async function fetchHotels(criteria = {}, token = '') {
  // maxSize:
  // - CERT_MODE: usa CERT_LIMIT (por defecto 5) salvo que pases otro maxSize en criteria
  // - Normal: 10000 por defecto salvo override en criteria
  const maxSize = CERT_MODE
    ? (criteria.maxSize ?? CERT_LIMIT)
    : (criteria.maxSize ?? 10000)

  const variables = {
    criteriaHotels: { ...criteria, maxSize },
    token
  }

  if (CERT_MODE) {
    // Una sola llamada, sin paginación; captura SOLO la respuesta para rs_hotels.json
    const data = await requestWithCapture(
      'hotels',
      variables,
      () => client.request(HOTEL_QUERY_CERT, variables),
      { onlyRS: true }
    )
    return data.hotelX.hotels
  }

  // Modo normal (permite paginar fuera, si lo necesitás, usando el token de retorno)
  const data = await client.request(HOTEL_QUERY_FULL, variables)
  return data.hotelX.hotels
}
