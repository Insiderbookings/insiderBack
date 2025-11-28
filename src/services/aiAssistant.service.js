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
      "Eres un asistente de viajes que convierte pedidos en JSON. " +
      "Siempre responde ÚNICAMENTE un objeto JSON válido con este esquema: " +
      `{
        "intent": "SEARCH" | "SMALL_TALK" | "HELP",
        "listingTypes": ["HOMES","HOTELS"],
        "location": {"city": string|null, "state": string|null, "country": string|null, "lat": number|null, "lng": number|null},
        "dates": {"checkIn": "YYYY-MM-DD" | null, "checkOut": "YYYY-MM-DD" | null, "flexible": boolean},
        "guests": {"adults": number|null, "children": number|null, "infants": number|null, "pets": number|null, "total": number|null},
        "amenities": {"parking": boolean, "workspace": boolean, "pool": boolean, "petFriendly": boolean},
        "budget": {"currency": string|null, "max": number|null, "min": number|null},
        "language": "es",
        "notes": string[]
      }`,
  },
];

const defaultPlan = {
  intent: "SEARCH",
  listingTypes: ["HOMES"],
  location: { city: null, state: null, country: null, lat: null, lng: null },
  dates: { checkIn: null, checkOut: null, flexible: true },
  guests: { adults: null, children: null, infants: null, pets: null, total: null },
  amenities: { parking: false, workspace: false, pool: false, petFriendly: false },
  budget: { currency: null, max: null, min: null },
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
    budget: { ...defaultPlan.budget, ...(raw.budget || {}) },
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
    const reply =
      inventory.homes?.length || inventory.hotels?.length
        ? "Encontré algunas opciones que encajan con tu búsqueda. Revisa los resultados debajo y dime si querés ajustar fechas o presupuesto."
        : "Todavía no pude encontrar coincidencias. Probá cambiando ciudad, fechas o cantidad de huéspedes.";
    return { reply, followUps: [] };
  }

  try {
    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Responde en español latino neutral. Devuelve siempre JSON con shape {\"reply\": string, \"followUps\": string[]}." +
            " Usa un tono amable y explica por qué los resultados son relevantes. Si no hay resultados, sugiere ajustes concretos.",
        },
        {
          role: "user",
          content: JSON.stringify({
            latestUserMessage,
            plan,
            inventory: summary,
          }),
        },
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
    const reply =
      inventory.homes?.length || inventory.hotels?.length
        ? "Encontré algunas coincidencias. Toca cualquiera para ver más detalles o dime cómo ajustar la búsqueda."
        : "Por ahora no encontré resultados. ¿Querés que busquemos en otra ciudad o con fechas diferentes?";
    return { reply, followUps: [] };
  }
};
