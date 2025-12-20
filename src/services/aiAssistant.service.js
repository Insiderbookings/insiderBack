import OpenAI from "openai";

const DEFAULT_MODEL = process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini";
const apiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;

const ensureClient = () => {
  if (!apiKey) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
};

export const isAssistantEnabled = () => Boolean(apiKey);

const SPANISH_HINTS = [
  " hola ",
  " gracias",
  " por favor",
  " buenas",
  " buen día",
  " buen dia",
  " alojamiento",
  " dónde",
  " donde",
  " habitación",
  " habitacion",
  " buscar",
  " necesito",
  " viaje",
  " familias",
  " personas",
];
const ENGLISH_HINTS = [" hello ", " hi ", " please ", " thanks", " looking for", " need ", " trip ", " hotel", " house "];

const detectLanguageFromText = (text = "", fallback = "en") => {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) return fallback || "en";
  const padded = ` ${normalized} `;
  const hasSpanishChars = /[ñáéíóúü¡¿]/i.test(text);
  if (hasSpanishChars) return "es";
  if (SPANISH_HINTS.some((hint) => padded.includes(hint))) return "es";
  if (ENGLISH_HINTS.some((hint) => padded.includes(hint))) return "en";
  return fallback || "en";
};

const languageInstruction = (lang) =>
  lang === "es"
    ? "Responde en español neutro (ajusta modismos si corresponde)."
    : "Reply in neutral English (and mirror idioms if needed).";

const pickLanguageText = (lang, english, spanish) => (lang === "es" ? spanish : english);

const sanitizeMessages = (messages = []) =>
  messages
    .map((message) => {
      if (!message) return null;
      const role = ["user", "assistant", "system"].includes(message.role) ? message.role : "user";
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);

const sanitizeStringList = (value, { uppercase = false } = {}) => {
  if (!Array.isArray(value) || !value.length) return [];
  const result = value
    .map((item) => {
      if (typeof item === "number") {
        item = String(item);
      }
      if (typeof item !== "string") return null;
      let normalized = item.trim();
      if (!normalized) return null;
      if (uppercase) normalized = normalized.toUpperCase();
      return normalized;
    })
    .filter(Boolean);
  return Array.from(new Set(result));
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveIntegerOrNull = (value) => {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : null;
};

const nonNegativeNumberOrNull = (value) => {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric >= 0 ? numeric : null;
};

const sanitizeListingTypes = (value) => {
  const allowed = new Set(["HOMES", "HOTELS"]);
  if (!Array.isArray(value) || !value.length) return [...defaultPlan.listingTypes];
  const sanitized = value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : null))
    .filter((item) => item && allowed.has(item));
  return sanitized.length ? Array.from(new Set(sanitized)) : [...defaultPlan.listingTypes];
};

const normalizeSortBy = (value) => {
  if (!value || typeof value !== "string") return defaultPlan.sortBy;
  const normalized = value.trim().toUpperCase();
  const allowed = new Set(["POPULARITY", "PRICE_ASC", "PRICE_DESC", "RELEVANCE"]);
  return allowed.has(normalized) ? normalized : defaultPlan.sortBy;
};

const normalizeBooleanFlag = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
};

const buildPlannerPrompt = () => [
  {
    role: "system",
    content:
      "You are a smart travel assistant that analyzes conversations and detects intents. " +
      "Your job is to determine if the user wants to SEARCH for accommodation, just SMALL_TALK, or needs HELP.\n\n" +

      "INTENT DETECTION RULES:\n" +
      "- SEARCH: Only when the user explicitly mentions looking for accommodation with enough information (location, type, dates, or guests). " +
      "Key verbs: 'search', 'need', 'want', 'show me', 'is there', 'available'.\n" +
      "- SMALL_TALK: Greetings, farewells, thanks, personal questions, casual conversation without search intent.\n" +
      "- HELP: Questions about functionality, assistant capabilities, or general information about accommodation types.\n\n" +

      "IMPORTANT: If the user only mentions a destination without explicit search request ('I want to go to Cordoba'), use SMALL_TALK, NOT SEARCH.\n" +
      "Only use SEARCH when there is a clear request to find/search/show accommodation.\n\n" +

      "LANGUAGE AND IDIOMS DETECTION:\n" +
      "Detect and recognize regional idioms:\n" +
      "- Argentinians: che, boludo, copado, finde, buenisimo, genial, dale, barbaro\n" +
      "- Mexicans: wey, chido, padre, que onda\n" +
      "- Chileans: po, cachai, bacan\n" +
      "- Colombians: parce, chevere, berraco\n" +
      "Note these idioms in 'notes' so the assistant can respond in the same register if needed.\n\n" +

      "EXAMPLES:\n" +
      "User: 'Hi, how are you?' -> intent: SMALL_TALK\n" +
      "User: 'What types of accommodation do you have?' -> intent: HELP\n" +
      "User: 'Looking for a house in Cordoba for 4' -> intent: SEARCH\n" +
      "User: 'Hey, do you have something cool?' -> intent: SMALL_TALK (lacks specific info)\n" +
      "User: 'I want to go to Bariloche' -> intent: SMALL_TALK (no search request)\n" +
      "User: 'Show me hotels in CABA' -> intent: SEARCH\n\n" +

      "FILTERING & SORTING RULES:\n" +
      "- Fill location city/state/country and lat/lng when provided. If the user requests proximity (\"1km around Movistar Arena\"), set location.radiusKm and location.landmark.\n" +
      "- Detect HOME filters: propertyTypes (HOUSE, APARTMENT, CABIN, etc.), spaceTypes (ENTIRE_PLACE, PRIVATE_ROOM, SHARED_ROOM), amenityKeys (POOL, PARKING, BBQ), and tagKeys (BEACHFRONT, LUXURY, FAMILY). Use uppercase keys.\n" +
      "- Detect HOTEL filters: amenityCodes from catalog names, amenityItemIds when numeric IDs are provided, preferredOnly flag, and minRating based on star ranks.\n" +
      "- Capture guest requirements (adults, children, pets) plus requested bedrooms, beds, bathrooms, or total guests for homes.\n" +
      "- Detect explicit budgets and ordering like 'cheapest', 'precios altos', or 'ordenar por precio'. Map to sortBy PRICE_ASC or PRICE_DESC. Respect requested limit counts when possible.\n\n" +

      "Respond ONLY with a valid JSON object with this schema:\n" +
      `{
        "intent": "SEARCH" | "SMALL_TALK" | "HELP",
        "listingTypes": ["HOMES","HOTELS"],
        "location": {"city": string|null, "state": string|null, "country": string|null, "lat": number|null, "lng": number|null, "radiusKm": number|null, "landmark": string|null},
        "dates": {"checkIn": "YYYY-MM-DD" | null, "checkOut": "YYYY-MM-DD" | null, "flexible": boolean},
        "guests": {"adults": number|null, "children": number|null, "infants": number|null, "pets": number|null, "total": number|null},
        "amenities": {"parking": boolean, "workspace": boolean, "pool": boolean, "petFriendly": boolean},
        "homeFilters": {
          "propertyTypes": string[],
          "spaceTypes": string[],
          "amenityKeys": string[],
          "tagKeys": string[],
          "maxGuests": number|null,
          "minBedrooms": number|null,
          "minBeds": number|null,
          "minBathrooms": number|null
        },
        "hotelFilters": {
          "amenityCodes": string[],
          "amenityItemIds": string[],
          "preferredOnly": boolean,
          "minRating": number|null
        },
        "budget": {"currency": string|null, "max": number|null, "min": number|null},
        "sortBy": "POPULARITY" | "PRICE_ASC" | "PRICE_DESC" | "RELEVANCE",
        "limit": number|null,
        "language": "en",
        "notes": string[]
      }`,
  },
];

const defaultPlan = {
  intent: "SMALL_TALK",
  listingTypes: ["HOMES"],
  location: { city: null, state: null, country: null, lat: null, lng: null, radiusKm: null, landmark: null },
  dates: { checkIn: null, checkOut: null, flexible: true },
  guests: { adults: null, children: null, infants: null, pets: null, total: null },
  amenities: { parking: false, workspace: false, pool: false, petFriendly: false },
  homeFilters: {
    propertyTypes: [],
    spaceTypes: [],
    amenityKeys: [],
    tagKeys: [],
    maxGuests: null,
    minBedrooms: null,
    minBeds: null,
    minBathrooms: null,
  },
  hotelFilters: {
    amenityCodes: [],
    amenityItemIds: [],
    preferredOnly: false,
    minRating: null,
  },
  budget: { currency: null, max: null, min: null },
  sortBy: "RELEVANCE",
  limit: null,
  language: "es",
  notes: [],
};

const mergePlan = (raw) => {
  if (!raw || typeof raw !== "object") return { ...defaultPlan };
  const locationInput = raw.location || {};
  const mergedLocation = {
    ...defaultPlan.location,
    ...locationInput,
  };
  const latValue = numberOrNull(locationInput.lat);
  if (latValue !== null) mergedLocation.lat = latValue;
  const lngValue = numberOrNull(locationInput.lng);
  if (lngValue !== null) mergedLocation.lng = lngValue;
  const radiusValue =
    nonNegativeNumberOrNull(locationInput.radiusKm ?? locationInput.radius_km ?? locationInput.radius) ??
    defaultPlan.location.radiusKm;
  mergedLocation.radiusKm = radiusValue;
  const landmarkValue =
    typeof locationInput.landmark === "string" && locationInput.landmark.trim().length
      ? locationInput.landmark.trim()
      : defaultPlan.location.landmark;
  mergedLocation.landmark = landmarkValue;

  const rawHomeFilters = raw.homeFilters || raw.home_filters || {};
  const homeFilters = {
    ...defaultPlan.homeFilters,
    ...rawHomeFilters,
    propertyTypes: sanitizeStringList(rawHomeFilters.propertyTypes ?? [], { uppercase: true }),
    spaceTypes: sanitizeStringList(rawHomeFilters.spaceTypes ?? [], { uppercase: true }),
    amenityKeys: sanitizeStringList(rawHomeFilters.amenityKeys ?? rawHomeFilters.amenities ?? [], { uppercase: true }),
    tagKeys: sanitizeStringList(rawHomeFilters.tagKeys ?? rawHomeFilters.tags ?? [], { uppercase: true }),
  };
  const resolvedMaxGuests =
    positiveIntegerOrNull(rawHomeFilters.maxGuests ?? rawHomeFilters.guests ?? raw.guests?.total) ??
    defaultPlan.homeFilters.maxGuests;
  const resolvedBedrooms =
    positiveIntegerOrNull(rawHomeFilters.minBedrooms ?? rawHomeFilters.bedrooms ?? raw.bedrooms) ??
    defaultPlan.homeFilters.minBedrooms;
  const resolvedBeds =
    positiveIntegerOrNull(rawHomeFilters.minBeds ?? rawHomeFilters.beds ?? raw.beds) ??
    defaultPlan.homeFilters.minBeds;
  const resolvedBathrooms =
    nonNegativeNumberOrNull(rawHomeFilters.minBathrooms ?? rawHomeFilters.bathrooms ?? raw.bathrooms) ??
    defaultPlan.homeFilters.minBathrooms;
  homeFilters.maxGuests = resolvedMaxGuests;
  homeFilters.minBedrooms = resolvedBedrooms;
  homeFilters.minBeds = resolvedBeds;
  homeFilters.minBathrooms = resolvedBathrooms;

  const rawHotelFilters = raw.hotelFilters || raw.hotel_filters || {};
  const hotelFilters = {
    ...defaultPlan.hotelFilters,
    ...rawHotelFilters,
    amenityCodes: sanitizeStringList(rawHotelFilters.amenityCodes ?? rawHotelFilters.amenities ?? [], { uppercase: true }),
    amenityItemIds: sanitizeStringList(rawHotelFilters.amenityItemIds ?? rawHotelFilters.itemIds ?? []),
  };
  hotelFilters.preferredOnly = normalizeBooleanFlag(
    rawHotelFilters.preferredOnly ?? rawHotelFilters.preferred ?? raw.preferredOnly,
    defaultPlan.hotelFilters.preferredOnly
  );
  const resolvedMinRating =
    nonNegativeNumberOrNull(rawHotelFilters.minRating ?? rawHotelFilters.rating ?? raw.rating) ??
    defaultPlan.hotelFilters.minRating;
  hotelFilters.minRating = resolvedMinRating;

  return {
    ...defaultPlan,
    ...raw,
    listingTypes: sanitizeListingTypes(raw.listingTypes),
    location: mergedLocation,
    dates: { ...defaultPlan.dates, ...(raw.dates || {}) },
    guests: { ...defaultPlan.guests, ...(raw.guests || {}) },
    amenities: { ...defaultPlan.amenities, ...(raw.amenities || {}) },
    homeFilters,
    hotelFilters,
    budget: { ...defaultPlan.budget, ...(raw.budget || {}) },
    sortBy: normalizeSortBy(raw.sortBy),
    limit: positiveIntegerOrNull(raw.limit) ?? defaultPlan.limit,
    notes: Array.isArray(raw.notes) ? raw.notes.filter(Boolean) : [],
  };
};

export const extractSearchPlan = async (messages = []) => {
  const client = ensureClient();
  const normalizedMessages = sanitizeMessages(messages);
  if (!client || !normalizedMessages.length) {
    return mergePlan(defaultPlan);
  }
  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [...buildPlannerPrompt(), ...normalizedMessages],
    });
    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) return mergePlan(defaultPlan);
    const parsed = JSON.parse(payload);
    return mergePlan(parsed);
  } catch (err) {
    console.error("[aiAssistant] extract plan failed", err?.message || err);
    return mergePlan(defaultPlan);
  }
};

export const generateAssistantReply = async ({ plan, messages = [], inventory = {} }) => {
  const client = ensureClient();
  const normalized = sanitizeMessages(messages);
  const latestUserMessage = [...normalized].reverse().find((msg) => msg.role === "user")?.content ?? "";
  const intent = plan?.intent || "SMALL_TALK";
  const modismos = Array.isArray(plan?.notes) ? plan.notes.join(", ") : "";
  const planLanguage = typeof plan?.language === "string" ? plan.language : null;
  const targetLanguage = detectLanguageFromText(latestUserMessage, planLanguage || "en");
  if (plan && typeof plan === "object") {
    plan.language = targetLanguage;
  }

  const summary = {
    location: plan?.location ?? null,
    guests: plan?.guests ?? null,
    dates: plan?.dates ?? null,
    homes: (inventory.homes || []).slice(0, 5).map((home) => ({
      id: home.id,
      title: home.title,
      city: home.city,
      pricePerNight: home.pricePerNight,
      currency: home.currency,
    })),
    hotels: (inventory.hotels || []).slice(0, 5).map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      preferred: hotel.preferred,
    })),
  };

  if (!client) {
    // Fallback without OpenAI
    if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? pickLanguageText(
            targetLanguage,
            "I found some options that match your search. Check the results below and tell me if you want to adjust dates or budget.",
            "Encontré algunas opciones que coinciden con tu búsqueda. Revisá los resultados y decime si querés ajustar fechas o presupuesto."
          )
          : pickLanguageText(
            targetLanguage,
            "I couldn't find matches yet. Try changing city, dates, or guest count.",
            "Todavía no encontré coincidencias. Probá cambiando ciudad, fechas o cantidad de personas."
          );
      return {
        reply,
        followUps:
          targetLanguage === "es"
            ? ["Buscar otra ciudad", "Cambiar fechas", "Agregar presupuesto máximo"]
            : ["Search another city", "Adjust dates", "Add budget limit"],
      };
    } else if (intent === "HELP") {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "I can help you look for homes (houses, apartments, cabins) and hotels. What are you looking for?",
          "Puedo ayudarte a buscar casas, departamentos, cabañas y hoteles. ¿Qué estás buscando?"
        ),
        followUps:
          targetLanguage === "es"
            ? ["Buscar una casa", "Necesito un hotel", "¿Qué comodidades hay?"]
            : ["Looking for a house", "Need a hotel", "What amenities are available?"],
      };
    } else {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "Hello! I am your travel assistant. How can I help you today?",
          "¡Hola! Soy tu asistente de viajes. ¿En qué puedo ayudarte hoy?"
        ),
        followUps:
          targetLanguage === "es"
            ? ["Buscar alojamiento", "¿Qué puedes hacer?", "Ver opciones disponibles"]
            : ["Search accommodation", "What can you do?", "See available options"],
      };
    }
  }

  try {
    let systemPrompt = "";
    const langLine = languageInstruction(targetLanguage);

    if (intent === "SEARCH") {
      systemPrompt =
        "You are a friendly and professional travel assistant. The user is looking for accommodation.\n" +
        `${langLine}\n` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- If there are results: Return the 'reply' as a single, VERY concise and helpful sentence. If a location is known, mention it (e.g., 'I found these options in [Location] for you').\n" +
        "- If NO results: Suggest concrete adjustments (change city, dates, budget).\n" +
        "- followUps: 3-4 relevant follow-up suggestions.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else if (intent === "HELP") {
      systemPrompt =
        "You are a friendly travel assistant. The user needs help or information.\n" +
        `${langLine}\n` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Explain what you can do: search for homes and hotels, filter by amenities, dates, budget.\n" +
        "- Be concise but helpful.\n" +
        "- followUps: Suggestions on how to start searching.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else {
      // SMALL_TALK
      systemPrompt =
        "You are a friendly and conversational travel assistant. The user is chatting casually.\n" +
        `${langLine}\n` +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Reply naturally and in a friendly way.\n" +
        "- If they mention destinations without asking for a search, ask for more details before searching.\n" +
        "- DO NOT assume they want to search unless explicitly requested.\n" +
        "- followUps: Natural questions to continue the conversation or guide them towards search.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    }

    const userContent = intent === "SEARCH"
      ? JSON.stringify({ latestUserMessage, plan, inventory: summary })
      : JSON.stringify({ latestUserMessage, conversationHistory: normalized.slice(-4) });

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const payload = completion.choices?.[0]?.message?.content;
    if (!payload) {
      throw new Error("empty response");
    }
    const parsed = JSON.parse(payload);
    return {
      reply: parsed.reply ?? "",
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.filter(Boolean).slice(0, 4) : [],
    };
  } catch (err) {
    console.error("[aiAssistant] generate reply failed", err?.message || err);

    // Fallback based on intent
    if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? pickLanguageText(
            targetLanguage,
            "I found some matches. Tap any to see more details or tell me how to adjust the search.",
            "Encontré algunas coincidencias. Tocá cualquiera para ver más detalles o decime cómo ajustamos la búsqueda."
          )
          : pickLanguageText(
            targetLanguage,
            "I couldn't find results yet. Try changing the city, dates, or guest count.",
            "Todavía no encontré resultados. Probá cambiar la ciudad, las fechas o la cantidad de personas."
          );
      return { reply, followUps: [] };
    } else if (intent === "HELP") {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "I can help you find homes and hotels. Tell me what you need and I'll show you options.",
          "Puedo ayudarte a encontrar casas y hoteles. Contame qué necesitás y te muestro opciones."
        ),
        followUps: [],
      };
    } else {
      return {
        reply: pickLanguageText(
          targetLanguage,
          "Hello! How can I help you today?",
          "Hola, ¿en qué puedo ayudarte hoy?"
        ),
        followUps: [],
      };
    }
  }
};
