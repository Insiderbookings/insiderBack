/**
 * src/services/tgx/boards.service.js
 * Wrapper para la operación Boards de Hotel‑X
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

/* ────────────────────────────── 2. Query Boards (AST) - COMPLETA ────────────────────────────── */
const BOARDS_Q = gql`
  query BoardsTGX($criteria: HotelXBoardQueryInput!) {
    hotelX {
      boards(criteria: $criteria) {
        edges {
          node {
            createdAt
            updatedAt
            boardData {
              boardCode
              texts {
                text
                language
              }
            }
          }
        }
      }
    }
  }
`

/* ────────────────────────────── 3. Función de bajo nivel: Boards ────────────────────────────── */
export async function fetchBoardsTGX(criteria) {
  const vars = { criteria }
  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Boards Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(BOARDS_Q, vars)
    if (DEBUG) {
      
    }
    return data.hotelX.boards
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Boards Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
export function mapBoards(boardsResponse) {
  if (!boardsResponse?.edges?.length) return []

  return boardsResponse.edges.map((edge) => ({
    boardCode: edge.node.boardData.boardCode,
    texts: edge.node.boardData.texts || [],
    createdAt: edge.node.createdAt,
    updatedAt: edge.node.updatedAt,

    // Helper para obtener texto en un idioma específico
    getText: function (language = "en") {
      const text = this.texts.find((t) => t.language === language)
      return text?.text || this.texts[0]?.text || this.boardCode
    },

    // Helper para determinar tipo de plan de comida
    getMealType: function () {
      const code = this.boardCode.toLowerCase()
      if (code.includes("bb") || code.includes("breakfast")) return "Breakfast"
      if (code.includes("hb") || code.includes("half")) return "Half Board"
      if (code.includes("fb") || code.includes("full")) return "Full Board"
      if (code.includes("ai") || code.includes("all")) return "All Inclusive"
      return "Room Only"
    },

    // Helper para obtener descripción del plan
    getDescription: function (language = "en") {
      const text = this.getText(language)
      if (text !== this.boardCode) return text

      // Fallback descriptions
      const descriptions = {
        "Room Only": "Accommodation only, no meals included",
        Breakfast: "Accommodation with breakfast included",
        "Half Board": "Accommodation with breakfast and dinner",
        "Full Board": "Accommodation with all meals included",
        "All Inclusive": "Accommodation with all meals, drinks and activities",
      }

      return descriptions[this.getMealType()] || text
    },
  }))
}

/* ────────────────────────────── 5. Función con paginación automática ────────────────────────────── */
export async function fetchAllBoards(criteria, maxResults = 1000) {
  // Nota: Boards no usa paginación con token según la documentación
  // pero mantenemos la estructura por consistencia
  const page = await fetchBoardsTGX(criteria)

  return {
    edges: page.edges || [],
    count: page.edges?.length || 0,
    token: null, // Boards no usa token
  }
}
