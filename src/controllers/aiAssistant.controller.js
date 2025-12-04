import { extractSearchPlan, generateAssistantReply, isAssistantEnabled } from "../services/aiAssistant.service.js";
import { searchHomesForPlan, searchHotelsForPlan } from "../services/assistantSearch.service.js";

const QUICK_START_PROMPTS = [
  "Show me homes for 4 people in downtown Cordoba with parking for the third week of January.",
  "Looking for a business-class hotel in Buenos Aires with breakfast included.",
  "Need a pet-friendly cabin near Bariloche for 6 guests.",
];
const MAX_RESULTS = 3;

const normalizeMessagesInput = (messages) => {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((message) => {
      if (!message) return null;
      const role = typeof message.role === "string" ? message.role : "user";
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
};

const buildResultCounts = (inventory) => ({
  homes: Array.isArray(inventory?.homes) ? inventory.homes.length : 0,
  hotels: Array.isArray(inventory?.hotels) ? inventory.hotels.length : 0,
});

const buildDebugInfo = (plan) => ({
  listingTypes: plan?.listingTypes ?? [],
  location: plan?.location ?? null,
  guests: plan?.guests ?? null,
  amenities: plan?.amenities ?? null,
});

export const handleAssistantSearch = async (req, res) => {
  const messages = normalizeMessagesInput(req.body?.messages);
  if (!messages.length) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const plan = await extractSearchPlan(messages);
  const intent = plan?.intent || "SMALL_TALK";

  // Solo buscar si el intent es SEARCH
  const shouldSearch = intent === "SEARCH";

  try {
    let inventory = { homes: [], hotels: [] };
    let counts = buildResultCounts(inventory);

    if (shouldSearch) {
      const listingTypes = Array.isArray(plan?.listingTypes) ? plan.listingTypes : ["HOMES"];
      const wantsHomes = listingTypes.includes("HOMES") || listingTypes.length === 0;
      const wantsHotels = listingTypes.includes("HOTELS");

      const [homes, hotels] = await Promise.all([
        wantsHomes ? searchHomesForPlan(plan, { limit: req.body?.limit?.homes }) : [],
        wantsHotels ? searchHotelsForPlan(plan, { limit: req.body?.limit?.hotels }) : [],
      ]);

      counts = buildResultCounts({ homes, hotels });
      inventory = {
        homes: Array.isArray(homes) ? homes.slice(0, MAX_RESULTS) : [],
        hotels: Array.isArray(hotels) ? hotels.slice(0, MAX_RESULTS) : [],
      };
    }

    const replyPayload = await generateAssistantReply({ plan, messages, inventory });

    return res.json({
      ok: true,
      reply: replyPayload.reply,
      followUps: replyPayload.followUps,
      plan,
      inventory,
      counts,
      assistantReady: isAssistantEnabled(),
      quickStartPrompts: QUICK_START_PROMPTS,
      debug: { ...buildDebugInfo(plan), intent },
    });
  } catch (err) {
    console.error("[aiAssistant] query failed", err);
    return res.status(500).json({ error: "Unable to process assistant query right now" });
  }
};
