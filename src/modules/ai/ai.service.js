import { extractSearchPlan } from "../../services/aiAssistant.service.js";
import { AI_FLAGS, AI_LIMITS } from "./ai.config.js";
import { applyPlanToState, buildPlanOutcome, updateStageFromAction } from "./ai.planner.js";
import { enforcePolicy } from "./ai.policy.js";
import { renderAssistantPayload } from "./ai.renderer.js";
import { loadAssistantState } from "./ai.stateStore.js";
import { searchStays } from "./tools/index.js";
import { logAiEvent } from "./ai.telemetry.js";

const buildEmptyInventory = () => ({
  homes: [],
  hotels: [],
  matchTypes: { homes: "NONE", hotels: "NONE" },
});

const normalizeMessages = (messages = []) =>
  Array.isArray(messages)
    ? messages
        .map((message) => {
          if (!message) return null;
          const role = typeof message.role === "string" ? message.role : "user";
          const content = typeof message.content === "string" ? message.content.trim() : "";
          if (!content) return null;
          return { role, content };
        })
        .filter(Boolean)
    : [];

const applyPlanDefaults = (plan, state) => {
  const nextPlan = { ...(plan || {}) };
  const listingTypes =
    Array.isArray(nextPlan.listingTypes) && nextPlan.listingTypes.length
      ? nextPlan.listingTypes
      : Array.isArray(state?.preferences?.listingTypes) && state.preferences.listingTypes.length
        ? state.preferences.listingTypes
        : ["HOMES"];
  nextPlan.listingTypes = listingTypes;
  if (!nextPlan.sortBy && state?.preferences?.sortBy) {
    nextPlan.sortBy = state.preferences.sortBy;
  }
  return nextPlan;
};

const applyUiEventToPlan = (plan, uiEvent) => {
  const nextPlan = { ...(plan || {}) };
  if (!uiEvent) return nextPlan;
  const raw = typeof uiEvent === "string" ? uiEvent : uiEvent?.id || uiEvent?.event || "";
  const normalized = String(raw || "").trim().toUpperCase();
  if (!normalized) return nextPlan;

  if (normalized.includes("CHEAP") || normalized.includes("LOW_PRICE")) {
    nextPlan.sortBy = "PRICE_ASC";
  } else if (normalized.includes("EXPENSIVE") || normalized.includes("HIGH_PRICE")) {
    nextPlan.sortBy = "PRICE_DESC";
  } else if (normalized.includes("POPULAR")) {
    nextPlan.sortBy = "POPULARITY";
  }

  if (normalized.includes("HOTELS")) {
    nextPlan.listingTypes = ["HOTELS"];
  } else if (normalized.includes("HOMES")) {
    nextPlan.listingTypes = ["HOMES"];
  }

  return nextPlan;
};

export const runAiTurn = async ({
  sessionId,
  userId,
  message,
  messages,
  limits,
  stateOverride,
  uiEvent,
} = {}) => {
  if (!AI_FLAGS.chatEnabled) {
    return {
      inventory: buildEmptyInventory(),
      reply: "AI chat is disabled.",
      followUps: [],
      plan: null,
      state: stateOverride || null,
      ui: { chips: [], cards: [], inputs: [], sections: [] },
      intent: "SMALL_TALK",
      nextAction: "SMALL_TALK",
      safeMode: false,
    };
  }

  let normalizedMessages = normalizeMessages(messages);
  if (!normalizedMessages.length && message) {
    normalizedMessages = [{ role: "user", content: String(message).trim() }];
  }
  if (normalizedMessages.length > AI_LIMITS.maxMessages) {
    normalizedMessages = normalizedMessages.slice(-AI_LIMITS.maxMessages);
  }

  const existingState =
    stateOverride ||
    (sessionId && userId ? await loadAssistantState({ sessionId, userId }) : null);

  const planCandidate = await extractSearchPlan(normalizedMessages);
  const { state: nextState, plan: mergedPlanRaw } = applyPlanToState(existingState, planCandidate);
  const planWithUi = applyUiEventToPlan(mergedPlanRaw, uiEvent);
  const mergedPlan = applyPlanDefaults(planWithUi, nextState);
  const outcome = buildPlanOutcome({ state: nextState, plan: mergedPlan });
  const policy = enforcePolicy({
    state: nextState,
    intent: outcome.intent,
    nextAction: outcome.nextAction,
  });
  const resolvedIntent = policy.intent || outcome.intent;
  const resolvedNextAction = policy.nextAction || outcome.nextAction;
  if (mergedPlan && resolvedIntent) {
    mergedPlan.intent = resolvedIntent;
  }

  let inventory = buildEmptyInventory();
  if (resolvedNextAction === "RUN_SEARCH") {
    inventory = await searchStays(mergedPlan, {
      limit: limits,
      maxResults: AI_LIMITS.maxResults,
    });
  }

  const updatedState = updateStageFromAction(nextState, resolvedNextAction);
  if (resolvedNextAction === "RUN_SEARCH") {
    const shownIds = [
      ...(inventory.homes || []).map((item) => String(item.id)),
      ...(inventory.hotels || []).map((item) => String(item.id)),
    ].filter(Boolean);
    updatedState.lastResultsContext = {
      lastSearchId: `search-${Date.now()}`,
      shownIds,
    };
  }

  const rendered = await renderAssistantPayload({
    plan: mergedPlan,
    messages: normalizedMessages,
    inventory,
    nextAction: resolvedNextAction,
  });

  logAiEvent("turn", {
    sessionId,
    userId,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    missing: outcome.missing,
    homes: inventory.homes?.length || 0,
    hotels: inventory.hotels?.length || 0,
  });

  return {
    reply: rendered.assistant?.text || "",
    assistant: rendered.assistant || { text: "", tone: "neutral", disclaimers: [] },
    followUps: rendered.followUps || [],
    ui: rendered.ui || { chips: [], cards: [], inputs: [], sections: [] },
    plan: mergedPlan,
    inventory,
    state: updatedState,
    intent: resolvedIntent,
    nextAction: resolvedNextAction,
    safeMode: outcome.safeMode,
  };
};
