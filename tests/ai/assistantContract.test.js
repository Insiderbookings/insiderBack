import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAssistantResponsePayload,
  buildAssistantUiSnapshot,
  getAiClientType,
} from "../../src/modules/ai/ai.contract.js";

test("getAiClientType normalizes the web client header", () => {
  assert.equal(getAiClientType({ headers: { "x-client-type": " Web " } }), "web");
  assert.equal(
    getAiClientType({ "x-client-platform": "react-native" }),
    "react-native",
  );
  assert.equal(getAiClientType({ headers: {} }), "");
});

test("buildAssistantUiSnapshot merges safe web sources into the stored ui", () => {
  const snapshot = buildAssistantUiSnapshot(
    {
      sections: [{ type: "summary", body: "Curated options" }],
      meta: { nextAction: "RUN_SEARCH" },
    },
    [
      { title: "Insider Guide", url: "https://www.insider.com/guide" },
      { title: "Booking", url: "https://www.booking.com/hotel/foo" },
    ],
  );

  assert.deepEqual(snapshot?.sections, [
    { type: "summary", body: "Curated options" },
  ]);
  assert.deepEqual(snapshot?.webSources, [
    { title: "Insider Guide", url: "https://www.insider.com/guide" },
  ]);
});

test("buildAssistantResponsePayload derives message metadata from ui fallback fields", () => {
  const payload = buildAssistantResponsePayload({
    conversationId: "session-123",
    replyText: "I found two strong options for you.",
    result: {
      intent: "hotel_search",
      ui: {
        meta: {
          nextAction: "RUN_SEARCH",
          followUpKind: "RESULT_DETAIL",
          replyMode: "answer_from_results",
          referencedHotelIds: ["h-1", "h-2"],
          webSearchUsed: true,
        },
      },
      webSources: [
        { title: "Insider Guide", url: "https://www.insider.com/guide" },
        { title: "Booking", url: "https://www.booking.com/hotel/foo" },
      ],
    },
    counts: { hotels: 2, homes: 0 },
    searchContext: { where: "Madrid" },
    sections: [{ type: "summary", body: "Best matches" }],
    quickReplies: ["Show more"],
    items: [{ id: "h-1", inventoryType: "HOTEL" }],
    quickStartPrompts: ["Find me boutique hotels in Madrid"],
    assistantReady: true,
    closingMessage: "Want me to compare them?",
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.sessionId, "session-123");
  assert.equal(payload.message, "I found two strong options for you.");
  assert.equal(payload.nextAction, "RUN_SEARCH");
  assert.equal(payload.followUpKind, "RESULT_DETAIL");
  assert.equal(payload.replyMode, "answer_from_results");
  assert.deepEqual(payload.referencedHotelIds, ["h-1", "h-2"]);
  assert.equal(payload.webSearchUsed, true);
  assert.deepEqual(payload.webSources, [
    { title: "Insider Guide", url: "https://www.insider.com/guide" },
  ]);
  assert.equal(payload.closingMessage, "Want me to compare them?");
});
