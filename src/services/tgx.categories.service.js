/*********************************************************************************************
 * src/services/tgx/categories.service.js
 * Wrapper para la operación Categories de Hotel‑X
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

/* ────────────────────────────── 2. Query Categories (AST) - COMPLETA ────────────────────────────── */
const CATEGORIES_Q = gql`
  query CategoriesTGX($criteria: HotelXCategoryQueryInput!) {
    hotelX {
      categories(criteria: $criteria) {
        edges {
          cursor
          node {
            createdAt
            updatedAt
            categoryData {
              categoryCode
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

/* ────────────────────────────── 3. Función de bajo nivel: Categories ────────────────────────────── */
export async function fetchCategoriesTGX(criteria) {
  const vars = { criteria }

  if (DEBUG) {
    console.debug("\n[DEBUG_TGX] ⬆︎ Categories Variables:\n", JSON.stringify(vars, null, 2))
  }

  try {
    const data = await tgxClient.request(CATEGORIES_Q, vars)

    if (DEBUG) {
      console.debug("\n[DEBUG_TGX] ⬇︎ Categories Response:\n", JSON.stringify(data, null, 2))
    }

    return data.hotelX.categories
  } catch (err) {
    if (DEBUG) {
      console.error("\n[DEBUG_TGX] ❌ Categories Error:\n", JSON.stringify(err.response?.errors ?? err, null, 2))
    }
    throw err
  }
}

/* ────────────────────────────── 4. Helper de mapeo para el front ────────────────────────────── */
export function mapCategories(categoriesResponse) {
  if (!categoriesResponse?.edges?.length) return []

  return categoriesResponse.edges.map((edge) => ({
    categoryCode: edge.node.categoryData.categoryCode,
    texts: edge.node.categoryData.texts || [],
    createdAt: edge.node.createdAt,
    updatedAt: edge.node.updatedAt,
    // Helper para obtener texto en un idioma específico
    getText: function (language = "en") {
      const text = this.texts.find((t) => t.language === language)
      return text?.text || this.texts[0]?.text || this.categoryCode
    },
  }))
}

/* ────────────────────────────── 5. Función con paginación automática ────────────────────────────── */
export async function fetchAllCategories(criteria, maxResults = 1000) {
  const collected = []
  let hasMore = true
  const currentCriteria = { ...criteria }

  while (hasMore && collected.length < maxResults) {
    const page = await fetchCategoriesTGX(currentCriteria)

    if (page.edges && page.edges.length > 0) {
      collected.push(...page.edges)
    }

    // Si no hay más resultados, terminar
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
  }
}
