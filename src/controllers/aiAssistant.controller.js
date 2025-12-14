import { extractSearchPlan, generateAssistantReply, isAssistantEnabled } from "../services/aiAssistant.service.js";
import { searchHomesForPlan, searchHotelsForPlan } from "../services/assistantSearch.service.js";
import {
  appendAssistantChatMessage,
  createAssistantSessionForUser,
  fetchAssistantMessages,
  deleteAssistantSession,
  getAssistantSessionWithMessages,
  listAssistantSessionsForUser,
} from "../services/aiAssistantHistory.service.js";

const QUICK_START_PROMPTS = [
  "Show me homes for 4 people in downtown Cordoba with parking for the third week of January.",
  "Looking for a business-class hotel in Buenos Aires with breakfast included.",
  "Need a pet-friendly cabin near Bariloche for 6 guests.",
];
const MAX_RESULTS = 5;

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

const getAuthenticatedUserId = (req) => {
  const value = Number(req.user?.id);
  return Number.isFinite(value) ? value : null;
};

const extractLatestMessageFromBody = (body) => {
  if (!body) return "";
  if (typeof body.message === "string" && body.message.trim()) {
    return body.message.trim();
  }
  const normalized = normalizeMessagesInput(body.messages);
  if (!normalized.length) return "";
  return normalized[normalized.length - 1].content || "";
};

export const handleAssistantSearch = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sessionId = req.body?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }

  const incomingMessage = extractLatestMessageFromBody(req.body);
  if (!incomingMessage) {
    return res.status(400).json({ error: "message is required" });
  }

  let storedMessages = [];
  try {
    await appendAssistantChatMessage(sessionId, userId, {
      role: "user",
      content: incomingMessage,
    });
    storedMessages = await fetchAssistantMessages(sessionId, userId, { limit: 60 });
  } catch (err) {
    if (err?.code === "AI_CHAT_NOT_FOUND") {
      return res.status(404).json({ error: "Chat session not found" });
    }
    console.error("[aiAssistant] failed to persist user message", err);
    return res.status(500).json({ error: "Unable to save chat message" });
  }

  const normalizedMessages = storedMessages.map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user",
    content: msg.content,
  }));

  const plan = await extractSearchPlan(normalizedMessages);
  console.log("[DEBUG] Extracted Plan:", JSON.stringify(plan, null, 2));
  const intent = plan?.intent || "SMALL_TALK";

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

    const replyPayload = await generateAssistantReply({
      plan,
      messages: normalizedMessages,
      inventory,
    });

    try {
      await appendAssistantChatMessage(sessionId, userId, {
        role: "assistant",
        content: replyPayload.reply,
        planSnapshot: plan,
        inventorySnapshot: inventory,
      });
    } catch (err) {
      console.error("[aiAssistant] failed to persist assistant reply", err);
      return res.status(500).json({ error: "Unable to save assistant reply" });
    }

    return res.json({
      ok: true,
      sessionId,
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

export const createAssistantChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const session = await createAssistantSessionForUser(userId);
    const messages = await fetchAssistantMessages(session.id, userId, { limit: 100 });
    return res.status(201).json({ ok: true, session, messages });
  } catch (err) {
    console.error("[aiAssistant] failed to create session", err);
    return res.status(500).json({ error: "Unable to create chat session" });
  }
};

export const listAssistantChats = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const limit = Number(req.query?.limit) || 25;
    const chats = await listAssistantSessionsForUser(userId, { limit });
    return res.json({ ok: true, chats });
  } catch (err) {
    console.error("[aiAssistant] failed to list sessions", err);
    return res.status(500).json({ error: "Unable to load chat history" });
  }
};

export const getAssistantChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sessionId = req.params?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  try {
    const limit = Number(req.query?.limit) || 200;
    const payload = await getAssistantSessionWithMessages(sessionId, userId, { limit });
    return res.json({ ok: true, ...payload });
  } catch (err) {
    if (err?.code === "AI_CHAT_NOT_FOUND") {
      return res.status(404).json({ error: "Chat session not found" });
    }
    console.error("[aiAssistant] failed to load session", err);
    return res.status(500).json({ error: "Unable to load chat session" });
  }
};

export const deleteAssistantChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sessionId = req.params?.sessionId;
  if (!sessionId) {
    return res.status(400).json({ error: "sessionId is required" });
  }
  try {
    await deleteAssistantSession(sessionId, userId);
    return res.json({ ok: true });
  } catch (err) {
    if (err?.code === "AI_CHAT_NOT_FOUND") {
      return res.status(404).json({ error: "Chat session not found" });
    }
    console.error("[aiAssistant] failed to delete session", err);
    return res.status(500).json({ error: "Unable to delete chat session" });
  }
};
