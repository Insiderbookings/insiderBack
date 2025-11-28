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
      "Eres un asistente de viajes inteligente que analiza conversaciones y detecta intenciones. " +
      "Tu trabajo es determinar si el usuario quiere BUSCAR alojamiento, solo CONVERSAR, o necesita AYUDA.\n\n" +

      "REGLAS PARA DETECTAR INTENT:\n" +
      "- SEARCH: Solo cuando el usuario menciona explícitamente búsqueda de alojamiento con suficiente información (ubicación, tipo, fechas, o huéspedes). " +
      "Verbos clave: 'busco', 'necesito', 'quiero', 'mostrame', 'tenés disponible', 'hay'.\n" +
      "- SMALL_TALK: Saludos, despedidas, agradecimientos, preguntas personales, conversación casual sin intención de búsqueda.\n" +
      "- HELP: Preguntas sobre funcionalidad, capacidades del asistente, o información general sobre tipos de alojamiento.\n\n" +

      "IMPORTANTE: Si el usuario solo menciona un destino sin pedir búsqueda explícita ('quiero ir a Córdoba'), usa SMALL_TALK, NO SEARCH.\n" +
      "Solo usa SEARCH cuando haya una solicitud clara de encontrar/buscar/mostrar alojamiento.\n\n" +

      "DETECCIÓN DE LENGUAJE Y MODISMOS:\n" +
      "Detecta y reconoce modismos regionales:\n" +
      "- Argentinos: che, boludo, copado, finde, buenísimo, genial, dale, bárbaro\n" +
      "- Mexicanos: wey, chido, padre, qué onda\n" +
      "- Chilenos: po, cachai, bacán\n" +
      "- Colombianos: parce, chévere, berraco\n" +
      "Anota estos modismos en 'notes' para que el asistente responda en el mismo registro.\n\n" +

      "EJEMPLOS:\n" +
      "Usuario: 'Hola, cómo andás?' → intent: SMALL_TALK\n" +
      "Usuario: '¿Qué tipos de alojamiento tenés?' → intent: HELP\n" +
      "Usuario: 'Busco casa en Córdoba para 4' → intent: SEARCH\n" +
      "Usuario: 'Che, tenés algo copado?' → intent: SMALL_TALK (falta info específica)\n" +
      "Usuario: 'Quiero ir a Bariloche' → intent: SMALL_TALK (no pide búsqueda)\n" +
      "Usuario: 'Mostrame hoteles en CABA' → intent: SEARCH\n\n" +

      "Responde ÚNICAMENTE un objeto JSON válido con este esquema:\n" +
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
        "language": "es",
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
    // Fallback sin OpenAI
    if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? "Encontré algunas opciones que encajan con tu búsqueda. Revisa los resultados debajo y dime si querés ajustar fechas o presupuesto."
          : "Todavía no pude encontrar coincidencias. Probá cambiando ciudad, fechas o cantidad de huéspedes.";
      return { reply, followUps: [] };
    } else if (intent === "HELP") {
      return {
        reply: "Puedo ayudarte a buscar homes (casas, departamentos, cabañas) y hoteles. ¿Qué estás buscando?",
        followUps: ["Busco una casa", "Necesito un hotel", "¿Qué amenities tienen?"],
      };
    } else {
      return {
        reply: "¡Hola! Soy tu asistente de viajes. ¿En qué puedo ayudarte hoy?",
        followUps: ["Buscar alojamiento", "¿Qué puedes hacer?", "Ver opciones disponibles"],
      };
    }
  }

  try {
    let systemPrompt = "";

    if (intent === "SEARCH") {
      systemPrompt =
        "Eres un asistente de viajes amigable y profesional. El usuario está buscando alojamiento.\n" +
        "Responde en español latino neutral (o usa modismos si el usuario los usa).\n" +
        "Devuelve siempre JSON con shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Si hay resultados: Explica por qué son relevantes, menciona características destacadas.\n" +
        "- Si NO hay resultados: Sugiere ajustes concretos (cambiar ciudad, fechas, presupuesto).\n" +
        "- followUps: 3-4 sugerencias de seguimiento relevantes.\n" +
        (modismos ? `- El usuario usa modismos: ${modismos}. Responde en el mismo registro.\n` : "");
    } else if (intent === "HELP") {
      systemPrompt =
        "Eres un asistente de viajes amigable. El usuario necesita ayuda o información.\n" +
        "Responde en español latino neutral (o usa modismos si el usuario los usa).\n" +
        "Devuelve siempre JSON con shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Explica qué puedes hacer: buscar homes y hoteles, filtrar por amenities, fechas, presupuesto.\n" +
        "- Sé conciso pero útil.\n" +
        "- followUps: Sugerencias de cómo empezar a buscar.\n" +
        (modismos ? `- El usuario usa modismos: ${modismos}. Responde en el mismo registro.\n` : "");
    } else {
      // SMALL_TALK
      systemPrompt =
        "Eres un asistente de viajes amigable y conversacional. El usuario está conversando casualmente.\n" +
        "Responde en español latino neutral (o usa modismos si el usuario los usa).\n" +
        "Devuelve siempre JSON con shape {\"reply\": string, \"followUps\": string[]}.\n" +
        "- Responde de forma natural y amigable.\n" +
        "- Si mencionan destinos sin pedir búsqueda, pregunta más detalles antes de buscar.\n" +
        "- NO asumas que quieren buscar a menos que lo pidan explícitamente.\n" +
        "- followUps: Preguntas naturales para continuar la conversación o guiarlos hacia búsqueda.\n" +
        (modismos ? `- El usuario usa modismos: ${modismos}. Responde en el mismo registro (ej: 'che', 'copado', 'dale').\n` : "");
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

    // Fallback basado en intent
    if (intent === "SEARCH") {
      const reply =
        inventory.homes?.length || inventory.hotels?.length
          ? "Encontré algunas coincidencias. Toca cualquiera para ver más detalles o dime cómo ajustar la búsqueda."
          : "Por ahora no encontré resultados. ¿Querés que busquemos en otra ciudad o con fechas diferentes?";
      return { reply, followUps: [] };
    } else if (intent === "HELP") {
      return {
        reply: "Puedo ayudarte a encontrar homes y hoteles. Decime qué necesitás y te muestro opciones.",
        followUps: [],
      };
    } else {
      return {
        reply: "¡Hola! ¿En qué puedo ayudarte hoy?",
        followUps: [],
      };
    }
  }
};
