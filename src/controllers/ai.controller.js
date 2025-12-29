import { runAiTurn } from "../modules/ai/ai.service.js";
import { saveAssistantState } from "../modules/ai/ai.stateStore.js";
import { isAssistantEnabled } from "../services/aiAssistant.service.js";
import {
  appendAssistantChatMessage,
  createAssistantSessionForUser,
  fetchAssistantMessages,
} from "../services/aiAssistantHistory.service.js";

const QUICK_START_PROMPTS = [
  "Show me homes for 4 people in downtown Cordoba with parking for the third week of January.",
  "Looking for a business-class hotel in Buenos Aires with breakfast included.",
  "Need a pet-friendly cabin near Bariloche for 6 guests.",
];

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

export const handleAiChat = async (req, res) => {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body || {};
  let conversationId = body.conversationId || body.sessionId || null;
  const incomingMessage = extractLatestMessageFromBody(body);
  if (!incomingMessage && !body.uiEvent) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    if (!conversationId) {
      const session = await createAssistantSessionForUser(userId);
      conversationId = session.id;
    }
  } catch (err) {
    console.error("[ai] failed to create session", err);
    return res.status(500).json({ error: "Unable to create chat session" });
  }

  if (incomingMessage) {
    try {
      await appendAssistantChatMessage(conversationId, userId, {
        role: "user",
        content: incomingMessage,
      });
    } catch (err) {
      if (err?.code === "AI_CHAT_NOT_FOUND") {
        return res.status(404).json({ error: "Chat session not found" });
      }
      console.error("[ai] failed to persist user message", err);
      return res.status(500).json({ error: "Unable to save chat message" });
    }
  }

  let storedMessages = [];
  try {
    storedMessages = await fetchAssistantMessages(conversationId, userId, { limit: 100 });
  } catch (err) {
    console.error("[ai] failed to load messages", err);
    return res.status(500).json({ error: "Unable to load messages" });
  }

  const normalizedMessages = storedMessages.map((msg) => ({
    role: msg.role === "assistant" ? "assistant" : msg.role === "system" ? "system" : "user",
    content: msg.content,
  }));

  try {
    const result = await runAiTurn({
      sessionId: conversationId,
      userId,
      messages: normalizedMessages,
      limits: body.limit,
      uiEvent: body.uiEvent,
    });

    try {
      await appendAssistantChatMessage(conversationId, userId, {
        role: "assistant",
        content: result.reply || "Ok.",
        planSnapshot: result.plan,
        inventorySnapshot: result.inventory,
      });
      try {
        await saveAssistantState({
          sessionId: conversationId,
          userId,
          state: result.state,
        });
      } catch (stateErr) {
        console.warn("[ai] failed to persist state", stateErr);
      }
    } catch (err) {
      console.error("[ai] failed to persist assistant reply", err);
      return res.status(500).json({ error: "Unable to save assistant reply" });
    }

    return res.json({
      ok: true,
      conversationId,
      assistant: result.assistant || { text: result.reply || "", tone: "neutral", disclaimers: [] },
      ui: result.ui,
      state: result.state,
      plan: result.plan,
      inventory: result.inventory,
      counts: {
        homes: Array.isArray(result.inventory?.homes) ? result.inventory.homes.length : 0,
        hotels: Array.isArray(result.inventory?.hotels) ? result.inventory.hotels.length : 0,
      },
      followUps: result.followUps,
      intent: result.intent,
      nextAction: result.nextAction,
      assistantReady: isAssistantEnabled(),
      quickStartPrompts: QUICK_START_PROMPTS,
    });
  } catch (err) {
    console.error("[ai] chat failed", err);
    return res.status(500).json({ error: "Unable to process assistant query right now" });
  }
};
