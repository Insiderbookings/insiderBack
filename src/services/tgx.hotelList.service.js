import 'dotenv/config'
import { GraphQLClient, gql } from 'graphql-request'

const client = new GraphQLClient(process.env.TGX_ENDPOINT, {
  headers: { Authorization: `ApiKey ${process.env.TGX_KEY}` }
})

const HOTEL_QUERY = gql`
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
                coordinates {
                  latitude
                  longitude
                }
                closestDestination {
                  code
                  available
                  texts {
                    text
                    language
                  }
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
              propertyType {
                propertyCode
                name
              }
              descriptions {
                type
                texts {
                  language
                  text
                }
              }
              medias {
                code
                url
                type
                order
              }
              rooms {
                edges {
                  node {
                    code
                    roomData {
                      code
                      roomCode
                      allAmenities {
                        edges {
                          node {
                            amenityData {
                              code
                              amenityCode
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
              allAmenities {
                edges {
                  node {
                    amenityData {
                      code
                      amenityCode
                    }
                  }
                }
              }
              giataData {
                updatedAt
                source
                href
              }
            }
          }
        }
      }
    }
  }
`

export async function fetchHotels(criteria = {}, token = '') {
  const variables = { criteriaHotels: criteria, token }
  const data = await client.request(HOTEL_QUERY, variables)
  return data.hotelX.hotels
}
