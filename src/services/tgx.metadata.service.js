/**
 * src/services/tgx/metadata.service.js
 * Wrapper para la operación Metadata de Hotel‑X
 * – Compatible con las credenciales demo (jun‑2025).
 * – Incluye modo DEBUG_TGX para ver variables y respuesta/errores en consola.
 */

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

/* ────────────────────────────── 2. Query Metadata (AST) - COMPLETA ────────────────────────────── */
const METADATA_Q = gql`
  query MetadataTGX($criteria: HotelXMetadataQueryInput!) {
    hotelX {
      metadata(criteria: $criteria) {
        edges {
          node {
            code
            metadataData {
              maxNumberHotels
              recommendedNumberHotels
              allowsCurrency
              release
              maxRelease
              minimumStay
              maxStay
              maxNumberRoomCandidates
              paxTypeRangeInRoomCandidates {
                ageRange {
                  ageFrom
                  ageTo
                }
                paxType
              }
              maxPaxInRoomCandidates
              maxPaxInAllRooms
              requiredRoomWithSamePaxConfiguration
              rateRules
              ageRange {
                ageFrom
                ageTo
              }
              languages
            }
          }
        }
      }
    }
  }
`

/* ────────────────────────────── 3. Función de bajo nivel: Metadata ────────────────────────────── */
export async function fetchMetadataTGX(criteria) {
  const vars = { criteria }
  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Metadata Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(METADATA_Q, vars)
    if (DEBUG) {
      console.debug("\n[DEBUG_TGX] ⬇︎ Metadata Response:\n", JSON.stringify(data, null, 2))
    }
    return data.hotelX.metadata
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Metadata Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
export function mapMetadata(metadataResponse) {
  if (!metadataResponse?.edges?.length) return []

  return metadataResponse.edges.map((edge) => ({
    supplierCode: edge.node.code,
    maxNumberHotels: edge.node.metadataData.maxNumberHotels,
    recommendedNumberHotels: edge.node.metadataData.recommendedNumberHotels,
    allowsCurrency: edge.node.metadataData.allowsCurrency,
    release: edge.node.metadataData.release,
    maxRelease: edge.node.metadataData.maxRelease,
    minimumStay: edge.node.metadataData.minimumStay,
    maxStay: edge.node.metadataData.maxStay,
    maxNumberRoomCandidates: edge.node.metadataData.maxNumberRoomCandidates,
    paxTypeRangeInRoomCandidates: edge.node.metadataData.paxTypeRangeInRoomCandidates || [],
    maxPaxInRoomCandidates: edge.node.metadataData.maxPaxInRoomCandidates,
    maxPaxInAllRooms: edge.node.metadataData.maxPaxInAllRooms,
    requiredRoomWithSamePaxConfiguration: edge.node.metadataData.requiredRoomWithSamePaxConfiguration,
    rateRules: edge.node.metadataData.rateRules,
    ageRange: edge.node.metadataData.ageRange,
    languages: edge.node.metadataData.languages || [],

    // Helper para obtener limitaciones de búsqueda
    getSearchLimitations: function () {
      return {
        maxHotels: this.maxNumberHotels,
        recommendedHotels: this.recommendedNumberHotels,
        maxRooms: this.maxNumberRoomCandidates,
        maxPaxPerRoom: this.maxPaxInRoomCandidates,
        maxTotalPax: this.maxPaxInAllRooms,
      }
    },

    // Helper para obtener restricciones de fechas
    getDateRestrictions: function () {
      return {
        minAdvanceBooking: this.release,
        maxAdvanceBooking: this.maxRelease,
        minStayDays: this.minimumStay,
        maxStayDays: this.maxStay,
      }
    },

    // Helper para obtener rangos de edad
    getAgeRestrictions: function () {
      return {
        general: this.ageRange,
        byPaxType: this.paxTypeRangeInRoomCandidates,
      }
    },

    // Helper para verificar si soporta una moneda
    supportsCurrency: function (currency) {
      return this.allowsCurrency.includes(currency)
    },

    // Helper para verificar si soporta un idioma
    supportsLanguage: function (language) {
      return this.languages.includes(language)
    },
  }))
}
