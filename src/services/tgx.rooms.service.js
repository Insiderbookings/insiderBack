/**
 * src/services/tgx/rooms.service.js
 * Wrapper para la operación Rooms de Hotel‑X
 * – Compatible con las credenciales demo (jun‑2025).
 * – Incluye modo DEBUG_TGX para ver variables y respuesta/errores en consola.
 * – Soporte para paginación con token.
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

/* ────────────────────────────── 2. Query Rooms (AST) - COMPLETA ────────────────────────────── */
const ROOMS_Q = gql`
  query RoomsTGX($criteria: HotelXRoomQueryInput!, $token: String) {
    hotelX {
      rooms(criteria: $criteria, token: $token) {
        token
        edges {
          node {
            createdAt
            updatedAt
            roomData {
              roomCode
              texts {
                text
                language
              }
              views {
                viewCode
                texts {
                  text
                  language
                }
              }
              medias {
                code
                url
                texts {
                  text
                  language
                }
              }
              beds {
                type
                count
                shared
              }
            }
          }
        }
      }
    }
  }
`

/* ────────────────────────────── 3. Función de bajo nivel: Rooms ────────────────────────────── */
export async function fetchRoomsTGX(criteria, token = "") {
  const vars = { criteria, token }
  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Rooms Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(ROOMS_Q, vars)
    if (DEBUG) {
      console.debug("\n[DEBUG_TGX] ⬇︎ Rooms Response:\n", JSON.stringify(data, null, 2))
    }
    return data.hotelX.rooms
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Rooms Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
export function mapRooms(roomsResponse) {
  if (!roomsResponse?.edges?.length) return []

  return roomsResponse.edges.map((edge) => ({
    roomCode: edge.node.roomData.roomCode,
    texts: edge.node.roomData.texts || [],
    views: edge.node.roomData.views || [],
    medias: edge.node.roomData.medias || [],
    beds: edge.node.roomData.beds || [],
    createdAt: edge.node.createdAt,
    updatedAt: edge.node.updatedAt,

    // Helper para obtener texto en un idioma específico
    getText: function (language = "en") {
      const text = this.texts.find((t) => t.language === language)
      return text?.text || this.texts[0]?.text || this.roomCode
    },

    // Helper para obtener descripción de vista
    getViewText: function (viewCode, language = "en") {
      const view = this.views.find((v) => v.viewCode === viewCode)
      if (!view) return ""
      const text = view.texts.find((t) => t.language === language)
      return text?.text || view.texts[0]?.text || viewCode
    },

    // Helper para obtener información de camas
    getBedInfo: function () {
      if (!this.beds.length) return "Standard bed configuration"
      return this.beds.map((bed) => `${bed.count} ${bed.type}${bed.shared ? " (shared)" : ""}`).join(", ")
    },

    // Helper para obtener primera imagen
    getMainImage: function () {
      return this.medias.length > 0 ? this.medias[0].url : null
    },
  }))
}

/* ────────────────────────────── 5. Función con paginación automática ────────────────────────────── */
export async function fetchAllRooms(criteria, maxResults = 1000) {
  const collected = []
  let token = ""
  let hasMore = true

  while (hasMore && collected.length < maxResults) {
    const page = await fetchRoomsTGX(criteria, token)

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
