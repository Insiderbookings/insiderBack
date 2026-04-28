import test from "node:test";
import assert from "node:assert/strict";

import {
  mapAssistantHistoryMessage,
  mapAssistantMessageFeedback,
} from "../../src/modules/ai/ai.historyContract.js";

test("mapAssistantHistoryMessage derives web parity fields from stored ui snapshot", () => {
  const message = mapAssistantHistoryMessage({
    get() {
      return {
        id: "msg-1",
        session_id: "session-1",
        role: "assistant",
        content: "Here are two options.",
        created_at: "2026-04-23T10:00:00.000Z",
        updated_at: "2026-04-23T10:00:05.000Z",
        plan_snapshot: JSON.stringify({ dates: { checkIn: "2026-05-01" } }),
        inventory_snapshot: JSON.stringify({ hotels: [{ id: "h-1" }] }),
        ui_snapshot: JSON.stringify({
          sections: [{ type: "summary", body: "Best options" }],
          webSources: [{ title: "Insider", url: "https://www.insider.com" }],
          meta: {
            nextAction: "RUN_SEARCH",
            followUpKind: "RESULT_DETAIL",
            replyMode: "answer_from_results",
            referencedHotelIds: ["h-1"],
            webSearchUsed: true,
          },
        }),
      };
    },
  });

  assert.equal(message?.id, "msg-1");
  assert.equal(message?.sessionId, "session-1");
  assert.equal(message?.nextAction, "RUN_SEARCH");
  assert.equal(message?.followUpKind, "RESULT_DETAIL");
  assert.equal(message?.replyMode, "answer_from_results");
  assert.deepEqual(message?.referencedHotelIds, ["h-1"]);
  assert.equal(message?.webSearchUsed, true);
  assert.deepEqual(message?.webSources, [
    { title: "Insider", url: "https://www.insider.com" },
  ]);
  assert.deepEqual(message?.planSnapshot, {
    dates: { checkIn: "2026-05-01" },
  });
});

test("mapAssistantMessageFeedback normalizes persisted feedback metadata", () => {
  const feedback = mapAssistantMessageFeedback({
    id: "fb-1",
    session_id: "session-1",
    message_id: "msg-1",
    value: "down",
    reason: "bad_results",
    metadata: JSON.stringify({ source: "web" }),
    created_at: "2026-04-23T10:01:00.000Z",
    updated_at: "2026-04-23T10:01:00.000Z",
  });

  assert.equal(feedback?.sessionId, "session-1");
  assert.equal(feedback?.messageId, "msg-1");
  assert.equal(feedback?.value, "down");
  assert.equal(feedback?.reason, "bad_results");
  assert.deepEqual(feedback?.metadata, { source: "web" });
});
