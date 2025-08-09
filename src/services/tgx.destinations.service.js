/*********************************************************************************************
 * src/services/tgx/destinations.service.js
 * Wrapper para la operación Destinations de Hotel‑X
 * – Compatible con las credenciales demo (jun‑2025).
 * – Incluye modo DEBUG_TGX para ver variables y respuesta/errores en consola.
 * – Soporte para paginación con token.
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

/* ────────────────────────────── 2. Query Destinations (AST) - COMPLETA ────────────────────────────── */
const DESTINATIONS_Q = gql`
  query DestinationsTGX($criteria: HotelXDestinationListInput!, $token: String) {
    hotelX {
      destinations(criteria: $criteria, token: $token) {
        token
        edges {
          node {
            createdAt
            updatedAt
            destinationData {
              code
              available
              destinationLeaf
              closestDestinations
              parent
              type
              texts {
                language
                text
              }
            }
          }
        }
      }
    }
  }
`

/* ────────────────────────────── 3. Función de bajo nivel: Destinations ────────────────────────────── */
export async function fetchDestinationsTGX(criteria, token = "") {
  const vars = { criteria, token }

  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Destinations Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(DESTINATIONS_Q, vars)

    if (DEBUG) {
      console.debug("\n[DEBUG_TGX] ⬇︎ Destinations Response:\n", JSON.stringify(data, null, 2))
    }

    return data.hotelX.destinations
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Destinations Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
export function mapDestinations(destinationsResponse) {
  if (!destinationsResponse?.edges?.length) return []

  return destinationsResponse.edges.map((edge) => ({
    code: edge.node.destinationData.code,
    available: edge.node.destinationData.available,
    destinationLeaf: edge.node.destinationData.destinationLeaf,
    closestDestinations: edge.node.destinationData.closestDestinations || [],
    parent: edge.node.destinationData.parent,
    type: edge.node.destinationData.type,
    texts: edge.node.destinationData.texts || [],
    createdAt: edge.node.createdAt,
    updatedAt: edge.node.updatedAt,
    // Helper para obtener texto en un idioma específico
    getText: function (language = "en") {
      const text = this.texts.find((t) => t.language === language)
      return text?.text || this.texts[0]?.text || this.code
    },
    // Helper para determinar si es una ciudad o zona
    isCity: function () {
      return this.type === "CITY"
    },
    isZone: function () {
      return this.type === "ZONE"
    },
  }))
}

/* ────────────────────────────── 5. Función con paginación automática ────────────────────────────── */
export async function fetchAllDestinations(criteria, maxResults = 1000) {
  const collected = []
  let token = ""
  let hasMore = true

  while (hasMore && collected.length < maxResults) {
    const page = await fetchDestinationsTGX(criteria, token)

    if (page.edges && page.edges.length > 0) {
      collected.push(...page.edges)
    }

    // Actualizar token para la siguiente página
    token = page.token || ""

    // Si no hay token, no hay más páginas
    if (!token) {
      hasMore = false
    }

    // Si no hay más resultados en esta página, terminar
    if (!page.edges || page.edges.length === 0) {
      hasMore = false
    }

    // Si hemos alcanzado el límite, terminar
    if (collected.length >= maxResults) {
      hasMore = false
    }
  }

  return {
    edges: collected.slice(0, maxResults),
    count: collected.length,
    token: token, // Token para continuar si es necesario
  }
}
