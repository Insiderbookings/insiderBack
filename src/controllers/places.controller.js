import axios from "axios";

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

    const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/autocomplete/json", {
      params,
      timeout: 4000,
    });

    const predictions = Array.isArray(data?.predictions)
      ? data.predictions.map((pred, index) => ({
          id: pred.place_id || `pred-${index}`,
          placeId: pred.place_id || null,
          title: pred.structured_formatting?.main_text || pred.description || "Location",
          subtitle: pred.structured_formatting?.secondary_text || pred.description || "Google Places",
        }))
      : [];

    return res.json({ predictions });
  } catch (err) {
    console.error("[autocompletePlaces]", err?.message || err);
    return res.status(500).json({ error: "Unable to load places" });
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
      name: place.name || "Point of interest",
      lat: place?.geometry?.location?.lat ?? null,
      lng: place?.geometry?.location?.lng ?? null,
      photoRef: place?.photos?.[0]?.photo_reference || null,
    }));

    return res.json({ places });
  } catch (err) {
    console.error("[nearbyPlaces]", err?.message || err);
    return res.status(500).json({ error: "Unable to load places" });
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
