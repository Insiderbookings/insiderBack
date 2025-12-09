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
      "- Argentinians: che, boludo, copado, finde, buenísimo, genial, dale, bárbaro\n" +
      "- Mexicans: wey, chido, padre, qué onda\n" +
      "- Chileans: po, cachai, bacán\n" +
      "- Colombians: parce, chévere, berraco\n" +
      "Note these idioms in 'notes' so the assistant can respond in the same register if needed.\n\n" +

      "EXAMPLES:\n" +
      "User: 'Hi, how are you?' → intent: SMALL_TALK\n" +
      "User: 'What types of accommodation do you have?' → intent: HELP\n" +
      "User: 'Looking for a house in Cordoba for 4' → intent: SEARCH\n" +
      "User: 'Hey, do you have something cool?' → intent: SMALL_TALK (lacks specific info)\n" +
      "User: 'I want to go to Bariloche' → intent: SMALL_TALK (no search request)\n" +
      "User: 'Show me hotels in CABA' → intent: SEARCH\n\n" +

      "Respond ONLY with a valid JSON object with this schema:\n" +
      `{
        "intent": "SEARCH" | "SMALL_TALK" | "HELP",
        "listingTypes": ["HOMES","HOTELS"],
        "location": {"city": string|null, "state": string|null, "country": string|null, "lat": number|null, "lng": number|null},
        "dates": {"checkIn": "YYYY-MM-DD" | null, "checkOut": "YYYY-MM-DD" | null, "flexible": boolean},
        "guests": {"adults": number|null, "children": number|null, "infants": number|null, "pets": number|null, "total": number|null},
        "amenities": {"parking": boolean, "workspace": boolean, "pool": boolean, "petFriendly": boolean},
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
  location: { city: null, state: null, country: null, lat: null, lng: null },
  dates: { checkIn: null, checkOut: null, flexible: true },
  guests: { adults: null, children: null, infants: null, pets: null, total: null },
  amenities: { parking: false, workspace: false, pool: false, petFriendly: false },
  budget: { currency: null, max: null, min: null },
  sortBy: "RELEVANCE",
  limit: null,
  language: "es",
  notes: [],
};

const mergePlan = (raw) => {
  if (!raw || typeof raw !== "object") return { ...defaultPlan };
  return {
    ...defaultPlan,
    ...raw,
    listingTypes: Array.isArray(raw.listingTypes) && raw.listingTypes.length ? raw.listingTypes : defaultPlan.listingTypes,
    location: { ...defaultPlan.location, ...(raw.location || {}) },
    dates: { ...defaultPlan.dates, ...(raw.dates || {}) },
    guests: { ...defaultPlan.guests, ...(raw.guests || {}) },
    amenities: { ...defaultPlan.amenities, ...(raw.amenities || {}) },
    amenities: { ...defaultPlan.amenities, ...(raw.amenities || {}) },
    budget: { ...defaultPlan.budget, ...(raw.budget || {}) },
    sortBy: raw.sortBy || defaultPlan.sortBy,
    limit: typeof raw.limit === "number" ? raw.limit : defaultPlan.limit,
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
          ? "I found some options that match your search. Check the results below and let me know if you want to adjust dates or budget."
          : "I couldn't find matches yet. Try changing city, dates, or guest count.";
      return { reply, followUps: [] };
    } else if (intent === "HELP") {
      return {
        reply: "I can help you look for homes (houses, apartments, cabins) and hotels. What are you looking for?",
        followUps: ["Looking for a house", "Need a hotel", "What amenities do they have?"],
      };
    } else {
      return {
        reply: "Hello! I am your travel assistant. How can I help you today?",
        followUps: ["Search accommodation", "What can you do?", "See available options"],
      };
    }
  }

  try {
    let systemPrompt = "";

    if (intent === "SEARCH") {
      systemPrompt =
        "You are a friendly and professional travel assistant. The user is looking for accommodation.\n" +
        "Reply in neutral English (or use idioms if the user uses them).\n" +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- If there are results: Explain why they are relevant, mention highlighted features.\n" +
        "- If NO results: Suggest concrete adjustments (change city, dates, budget).\n" +
        "- followUps: 3-4 relevant follow-up suggestions.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else if (intent === "HELP") {
      systemPrompt =
        "You are a friendly travel assistant. The user needs help or information.\n" +
        "Reply in neutral English (or use idioms if the user uses them).\n" +
        "Always return JSON with shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Explain what you can do: search for homes and hotels, filter by amenities, dates, budget.\n" +
        "- Be concise but helpful.\n" +
        "- followUps: Suggestions on how to start searching.\n" +
        (modismos ? `- The user uses idioms: ${modismos}. Respond in the same register.\n` : "");
    } else {
      // SMALL_TALK
      systemPrompt =
        "You are a friendly and conversational travel assistant. The user is chatting casually.\n" +
        "Reply in neutral English (or use idioms if the user uses them).\n" +
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
          ? "I found some matches. Tap any to see more details or tell me how to adjust the search."
          : "I couldn't find results yet. try changing the city, dates, or guest count.";
      return { reply, followUps: [] };
    } else if (intent === "HELP") {
      return {
        reply: "I can help you find homes and hotels. Tell me what you need and I'll show you options.",
        followUps: [],
      };
    } else {
      return {
        reply: "Hello! How can I help you today?",
        followUps: [],
      };
    }
  }
};
