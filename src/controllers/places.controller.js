import axios from "axios";

const shouldLogPlaces = String(process.env.PLACES_DEBUG || "").toLowerCase() === "true";
const maskKey = (key) => {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return `${key.slice(0, 2)}...`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
};

const getPlacesApiKey = () =>
  process.env.GOOGLE_PLACES_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  null;

export const autocompletePlaces = async (req, res) => {
  try {
    const input = typeof req.query?.input === "string" ? req.query.input.trim() : "";
    if (!input || input.length < 2) {
      return res.json({ predictions: [] });
    }

    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Google Places API key not configured" });
    }

    const params = {
      input,
      key: apiKey,
    };
    if (typeof req.query?.sessionToken === "string" && req.query.sessionToken.trim()) {
      params.sessiontoken = req.query.sessionToken.trim();
    }
    if (typeof req.query?.language === "string" && req.query.language.trim()) {
      params.language = req.query.language.trim();
    }
    if (typeof req.query?.country === "string" && req.query.country.trim()) {
      params.components = `country:${req.query.country.trim()}`;
    }

    if (shouldLogPlaces) {
      console.log("[places.autocomplete] request", {
        inputLength: input.length,
        hasSessionToken: Boolean(params.sessiontoken),
        language: params.language || null,
        country: params.components || null,
        key: maskKey(apiKey),
      });
    }

    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/autocomplete/json", {
      params,
      timeout: 4000,
    });

    if (shouldLogPlaces) {
      console.log("[places.autocomplete] response", {
        status: data?.status || null,
        errorMessage: data?.error_message || null,
        predictionsCount: Array.isArray(data?.predictions) ? data.predictions.length : 0,
      });
    }

    const predictions = Array.isArray(data?.predictions)
      ? data.predictions.map((pred, index) => ({
          id: pred.place_id || `pred-${index}`,
          placeId: pred.place_id || null,
          title: pred.structured_formatting?.main_text || pred.description || "Location",
          subtitle: pred.structured_formatting?.secondary_text || pred.description || "Google Places",
          types: normalizePlaceTypes(pred.types),
          kind: resolvePlaceKind(pred.types),
        }))
      : [];

    return res.json({ predictions });
  } catch (err) {
    console.error("[autocompletePlaces]", {
      message: err?.message || err,
      status: err?.response?.status || null,
      errorMessage: err?.response?.data?.error_message || err?.response?.data?.error || null,
    });
    return res.status(500).json({ error: "Unable to load places" });
  }
};

const pickAddressComponent = (components, type) => {
  if (!Array.isArray(components)) return null;
  const match = components.find((comp) => Array.isArray(comp?.types) && comp.types.includes(type));
  return match?.long_name || null;
};

const normalizePlaceTypes = (types) =>
  Array.isArray(types)
    ? types.map((type) => String(type ?? "").trim()).filter(Boolean)
    : [];

const resolvePlaceKind = (types) => {
  const normalized = normalizePlaceTypes(types);
  if (normalized.includes("lodging")) return "hotel";
  if (
    normalized.includes("tourist_attraction") ||
    normalized.includes("point_of_interest")
  ) {
    return "landmark";
  }
  if (
    normalized.includes("locality") ||
    normalized.some((type) => type.startsWith("administrative_area_level_"))
  ) {
    return "city";
  }
  return normalized.length ? "unknown" : null;
};

const PLACE_TYPE_PRIORITY = [
  "cafe",
  "restaurant",
  "bar",
  "bakery",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "shopping_mall",
  "store",
  "park",
  "subway_station",
  "train_station",
  "bus_station",
  "lodging",
];

const PLACE_TYPE_IGNORED = new Set([
  "establishment",
  "point_of_interest",
  "food",
  "store",
  "premise",
  "street_address",
  "route",
  "plus_code",
  "political",
]);

const pickPrimaryPlaceType = (types) => {
  const normalized = normalizePlaceTypes(types);
  if (!normalized.length) return null;
  const priorityHit = PLACE_TYPE_PRIORITY.find((type) => normalized.includes(type));
  if (priorityHit) return priorityHit;
  return normalized.find((type) => !PLACE_TYPE_IGNORED.has(type)) || normalized[0];
};

const humanizePlaceType = (type) => {
  const raw = String(type || "").trim();
  if (!raw) return null;
  return raw
    .split("_")
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
};

const buildPlaceResult = (source, fallbackLabel = null) => {
  if (!source) return null;
  const location = source.geometry?.location || {};
  const components = source.address_components || [];
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  const types = normalizePlaceTypes(source.types);
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    placeId: source.place_id || null,
    label: source.formatted_address || fallbackLabel || null,
    city: pickAddressComponent(components, "locality"),
    state: pickAddressComponent(components, "administrative_area_level_1"),
    country: pickAddressComponent(components, "country"),
    types,
    kind: resolvePlaceKind(types),
  };
};

const fetchPlacePhotoLookup = async ({
  placeId = "",
  query = "",
  language = null,
  lat = null,
  lng = null,
} = {}) => {
  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    throw new Error("Google Places API key not configured");
  }

  const trimmedPlaceId = String(placeId || "").trim();
  const trimmedQuery = String(query || "").trim();
  const latNum = Number(lat);
  const lngNum = Number(lng);
  const hasLocationBias = Number.isFinite(latNum) && Number.isFinite(lngNum);

  if (trimmedPlaceId) {
    const detailsParams = {
      place_id: trimmedPlaceId,
      fields: "photos,place_id,name,formatted_address",
      key: apiKey,
    };
    if (language) detailsParams.language = language;
    const { data } = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: detailsParams,
        timeout: 4000,
      },
    );
    const photoRef = data?.result?.photos?.[0]?.photo_reference || null;
    if (photoRef) {
      return {
        photoRef,
        placeId: data?.result?.place_id || trimmedPlaceId,
        name: data?.result?.name || null,
        address: data?.result?.formatted_address || null,
      };
    }
  }

  if (!trimmedQuery) {
    return {
      photoRef: null,
      placeId: trimmedPlaceId || null,
      name: null,
      address: null,
    };
  }

  const textSearchParams = {
    query: trimmedQuery,
    key: apiKey,
  };
  if (language) textSearchParams.language = language;
  if (hasLocationBias) {
    textSearchParams.location = `${latNum},${lngNum}`;
    textSearchParams.radius = 1200;
  }

  const { data } = await axios.get(
    "https://maps.googleapis.com/maps/api/place/textsearch/json",
    {
      params: textSearchParams,
      timeout: 4000,
    },
  );
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  return {
    photoRef: first?.photos?.[0]?.photo_reference || null,
    placeId: first?.place_id || trimmedPlaceId || null,
    name: first?.name || null,
    address: first?.formatted_address || null,
  };
};

export const geocodePlace = async (req, res) => {
  try {
    const placeId = typeof req.query?.placeId === "string" ? req.query.placeId.trim() : "";
    const query = typeof req.query?.query === "string" ? req.query.query.trim() : "";
    if (!placeId && !query) {
      return res.status(400).json({ error: "placeId or query required" });
    }
    console.log("[places.geocode] request", { placeId: placeId || null, query: query || null });

    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Google Places API key not configured" });
    }

    const language =
      typeof req.query?.language === "string" && req.query.language.trim()
        ? req.query.language.trim()
        : null;
    const fields = "geometry,formatted_address,place_id,address_component,type";
    let resolvedPlaceId = placeId;

    if (!resolvedPlaceId) {
      const findParams = {
        input: query,
        inputtype: "textquery",
        fields: "place_id",
        key: apiKey,
      };
      if (language) findParams.language = language;
    if (shouldLogPlaces) {
      console.log("[places.geocode] findplace request", {
        hasQuery: Boolean(query),
        language,
        key: maskKey(apiKey),
      });
    }

    const { data: findData } = await axios.get(
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
      {
        params: findParams,
        timeout: 4000,
      }
    );
      const candidate = Array.isArray(findData?.candidates) ? findData.candidates[0] : null;
      resolvedPlaceId = candidate?.place_id || "";
      console.log("[places.geocode] findplace status", findData?.status || "NO_STATUS");
      if (!resolvedPlaceId) {
        return res.json({ result: null, status: findData?.status || "NO_RESULTS" });
      }
    }

    const detailsParams = {
      place_id: resolvedPlaceId,
      fields,
      key: apiKey,
    };
    if (language) detailsParams.language = language;

    if (shouldLogPlaces) {
      console.log("[places.geocode] details request", {
        placeId: resolvedPlaceId || null,
        language,
        key: maskKey(apiKey),
      });
    }

    const { data: detailsData } = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: detailsParams,
        timeout: 4000,
      }
    );
    console.log("[places.geocode] details status", detailsData?.status || "NO_STATUS");

    if (detailsData?.status === "OK" && detailsData?.result) {
      const result = buildPlaceResult(detailsData.result || {}, query);
      return res.json({
        result: result
          ? {
              ...result,
              placeId: result.placeId || resolvedPlaceId || null,
              label: result.label || query || null,
            }
          : null,
        status: detailsData?.status || "OK",
      });
    }

    const geocodeParams = {
      key: apiKey,
    };
    if (language) geocodeParams.language = language;
    if (resolvedPlaceId) {
      geocodeParams.place_id = resolvedPlaceId;
    } else {
      geocodeParams.address = query;
    }
    if (shouldLogPlaces) {
      console.log("[places.geocode] geocode request", {
        placeId: resolvedPlaceId || null,
        hasQuery: Boolean(query),
        language,
        key: maskKey(apiKey),
      });
    }

    const { data: geocodeData } = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: geocodeParams,
        timeout: 4000,
      }
    );
    console.log("[places.geocode] geocode status", geocodeData?.status || "NO_STATUS");
    if (geocodeData?.status !== "OK" || !Array.isArray(geocodeData.results) || !geocodeData.results.length) {
      return res.json({ result: null, status: geocodeData?.status || detailsData?.status || "NO_RESULTS" });
    }
    const geoResult = buildPlaceResult(geocodeData.results[0] || {}, query);
    return res.json({
      result: geoResult
        ? {
            ...geoResult,
            placeId: geoResult.placeId || resolvedPlaceId || null,
            label: geoResult.label || query || null,
          }
        : null,
      status: geocodeData?.status || "OK",
    });
  } catch (err) {
    console.error("[geocodePlace]", {
      message: err?.message || err,
      status: err?.response?.status || null,
      errorMessage: err?.response?.data?.error_message || err?.response?.data?.error || null,
    });
    return res.status(500).json({ error: "Unable to geocode place" });
  }
};

export const nearbyPlaces = async (req, res) => {
  try {
    const lat = Number(req.query?.lat);
    const lng = Number(req.query?.lng);
    const radius = Number(req.query?.radius) || 1800;
    const type = typeof req.query?.type === "string" ? req.query.type.trim() : "tourist_attraction";
    const limit = Math.min(Number(req.query?.limit) || 12, 25);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat/lng required" });
    }

    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Google Places API key not configured" });
    }

    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
      params: {
        location: `${lat},${lng}`,
        radius,
        type,
        key: apiKey,
      },
      timeout: 4000,
    });

    const results = Array.isArray(data?.results) ? data.results.slice(0, limit) : [];
    const places = results.map((place, index) => ({
      id: place.place_id || `${lat}-${lng}-${index}`,
      placeId: place.place_id || null,
      name: place.name || "Point of interest",
      lat: place?.geometry?.location?.lat ?? null,
      lng: place?.geometry?.location?.lng ?? null,
      photoRef: place?.photos?.[0]?.photo_reference || null,
      types: normalizePlaceTypes(place?.types),
      type: humanizePlaceType(pickPrimaryPlaceType(place?.types)),
      vicinity: place?.vicinity || place?.formatted_address || null,
      address: place?.vicinity || place?.formatted_address || null,
    }));

    return res.json({ places });
  } catch (err) {
    console.error("[nearbyPlaces]", err?.message || err);
    return res.status(500).json({ error: "Unable to load places" });
  }
};

export const placePhotoLookup = async (req, res) => {
  try {
    const placeId =
      typeof req.query?.placeId === "string" ? req.query.placeId.trim() : "";
    const query =
      typeof req.query?.query === "string" ? req.query.query.trim() : "";
    const language =
      typeof req.query?.language === "string" && req.query.language.trim()
        ? req.query.language.trim()
        : null;
    const lat = req.query?.lat ?? null;
    const lng = req.query?.lng ?? null;

    if (!placeId && !query) {
      return res.status(400).json({ error: "placeId or query required" });
    }

    const result = await fetchPlacePhotoLookup({
      placeId,
      query,
      language,
      lat,
      lng,
    });

    return res.json({
      photoRef: result?.photoRef || null,
      placeId: result?.placeId || placeId || null,
      name: result?.name || null,
      address: result?.address || null,
    });
  } catch (err) {
    console.error("[placePhotoLookup]", {
      message: err?.message || err,
      status: err?.response?.status || null,
      errorMessage: err?.response?.data?.error_message || err?.response?.data?.error || null,
    });
    return res.status(500).json({ error: "Unable to resolve place photo" });
  }
};

export const staticMap = async (req, res) => {
  try {
    const lat = parseFloat(req.query?.lat);
    const lng = parseFloat(req.query?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng required" });
    }
    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Google Maps API key not configured" });
    }
    const zoom = Math.min(19, Math.max(1, parseInt(req.query?.zoom ?? "16", 10)));
    const size = "400x200";
    const markerColor = "0xF59E0B"; // amber to match POI pin color
    const mapRes = await axios.get("https://maps.googleapis.com/maps/api/staticmap", {
      params: {
        center: `${lat},${lng}`,
        zoom,
        size,
        scale: 2,
        markers: `color:${markerColor}|${lat},${lng}`,
        key: apiKey,
      },
      responseType: "arraybuffer",
      timeout: 5000,
      validateStatus: () => true,
    });

    if (mapRes.status !== 200) {
      const body = Buffer.from(mapRes.data, "binary").toString("utf8").slice(0, 300);
      console.error("[staticMap] Google error", mapRes.status, body);
      return res.status(502).json({ error: "Google Static Maps error", status: mapRes.status });
    }

    const contentType = mapRes.headers["content-type"] || "image/png";
    if (!contentType.startsWith("image/")) {
      const body = Buffer.from(mapRes.data, "binary").toString("utf8").slice(0, 300);
      console.error("[staticMap] unexpected content-type", contentType, body);
      return res.status(502).json({ error: "Unexpected response from Google", contentType });
    }

    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(Buffer.from(mapRes.data, "binary"));
  } catch (err) {
    console.error("[staticMap]", err?.message || err);
    return res.status(500).json({ error: "Unable to load static map" });
  }
};

export const placePhoto = async (req, res) => {
  try {
    const ref = typeof req.query?.ref === "string" ? req.query.ref.trim() : "";
    if (!ref) return res.status(400).json({ error: "photo ref required" });

    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return res.status(500).json({ error: "Google Places API key not configured" });
    }

    const photoRes = await axios.get("https://maps.googleapis.com/maps/api/place/photo", {
      params: { maxwidth: 400, photoreference: ref, key: apiKey },
      responseType: "arraybuffer",
      timeout: 4000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = photoRes.headers["content-type"] || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    return res.send(Buffer.from(photoRes.data, "binary"));
  } catch (err) {
    console.error("[placePhoto]", err?.message || err);
    return res.status(500).json({ error: "Unable to load photo" });
  }
};
