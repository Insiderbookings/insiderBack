// Script para probar la búsqueda directamente
import { searchTGX, mapSearchOptions } from "./services/tgx/search.service.js"

async function testSearch() {
  try {
    const criteria = {
      checkIn: "2027-05-28",
      checkOut: "2027-05-29",
      occupancies: [
        {
          paxes: [{ age: 30 }, { age: 30 }],
        },
      ],
      hotels: ["1", "2"],
      currency: "EUR",
      markets: ["ES"],
      language: "es",
      nationality: "ES",
    }

    const settings = {
      client: "client_demo",
      context: "HOTELTEST",
      testMode: true,
      timeout: 25000,
    }

    const filter = {
      access: { includes: ["2"] },
    }

    console.log("Ejecutando búsqueda...")
    const result = await searchTGX(criteria, settings, filter)

    console.log("Resultado crudo:", JSON.stringify(result, null, 2))

    const mapped = mapSearchOptions(result)
    console.log("Resultado mapeado:", JSON.stringify(mapped, null, 2))
  } catch (error) {
    console.error("Error en la búsqueda:", error)
    if (error.response?.errors) {
      console.error("Errores GraphQL:", JSON.stringify(error.response.errors, null, 2))
    }
  }
}

testSearch()
