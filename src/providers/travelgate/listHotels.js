import cache from "../../services/cache.js"
import { ensureHotelAliases } from "../../services/hotelAlias.service.js"
import { fetchHotels } from "./services/hotelList.service.js"

export const listHotels = async (req, res, next) => {
  try {
    const { access, hotelCodes, countries, destinationCodes, nextToken = "" } = req.query
    if (!access) return res.status(400).json({ error: "access param required" })

      console.log(access, "acces")

    // CERT: una llamada, sin filtros ni paginación, maxSize alto, y devolver tal cual
    if (process.env.TGX_CERT_MODE === 'true') {
      const cacheKey = `cert_hotels:${access}`
      const cached = await cache.get(cacheKey)
      if (cached) return res.json(cached)

      const page = await fetchHotels({ access, maxSize: 10000 }, "")
      // page ya es la respuesta de TGX (hotelX.hotels), ideal para rs_hotels.json
      await cache.set(cacheKey, page, 300)
      return res.json(page)
    }

    // Modo normal (no cert): tu lógica de paginación actual
    const cacheKey = `hotels:${access}:${hotelCodes || countries || "all"}:${nextToken || "first"}`
    const cached = await cache.get(cacheKey)
    if (cached) return res.json(cached)

    const criteria = {
      access,
      hotelCodes: hotelCodes ? hotelCodes.split(",") : undefined,
      countries: countries ? countries.split(",") : undefined,
      destinationCodes: destinationCodes ? destinationCodes.split(",") : undefined,
      maxSize: 10000, // también útil fuera de cert para minimizar páginas
    }

    let token = nextToken
    const collected = []
    let totalCountFromFirstPage = 0

    do {
      const page = await fetchHotels(criteria, token)
      if (!totalCountFromFirstPage) totalCountFromFirstPage = page.count || 0
      token = page.token || ""
      collected.push(...(page.edges || []))
    } while (token)

    const matchableHotels = collected
      .map((edge) => {
        const hotelData = edge?.node?.hotelData;
        if (!hotelData?.hotelCode) return null;
        const location = hotelData.location || {};
        const coords = location.coordinates || {};
        return {
          providerHotelId: hotelData.hotelCode,
          name: hotelData.hotelName,
          city: location.city,
          country: location.country,
          address: location.address,
          lat: coords.latitude,
          lng: coords.longitude,
        };
      })
      .filter(Boolean);

    let aliasMap = new Map();
    if (matchableHotels.length) {
      try {
        aliasMap = await ensureHotelAliases("travelgate", matchableHotels);
      } catch (aliasErr) {
        console.error("[travelgate][listHotels] alias matching failed:", aliasErr?.message || aliasErr);
      }
    }

    const edgesWithAlias = collected.map((edge) => {
      const hotelCode = String(edge?.node?.hotelData?.hotelCode ?? "");
      if (!hotelCode) return edge;
      const aliasInfo = aliasMap.get(hotelCode);
      if (!aliasInfo) return edge;
      return { ...edge, insiderMatch: aliasInfo };
    });

    const response = {
      count: totalCountFromFirstPage,
      returned: collected.length,
      edges: edgesWithAlias,
      nextToken: "",
    }

    await cache.set(cacheKey, response, 60)
    res.json(response)
  } catch (err) {
    next(err)
  }
}







