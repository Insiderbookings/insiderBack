import test from "node:test";
import assert from "node:assert/strict";

import { getPartnerClaimAgeDays } from "../../src/services/partnerCatalog.service.js";
import {
  buildPartnerTrialSimulationDates,
  normalizePartnerTrialSimulationDay,
} from "../../src/services/partnerTrialSimulation.service.js";

test("normalizes accepted partner trial simulation days", () => {
  assert.equal(normalizePartnerTrialSimulationDay("7"), 7);
  assert.equal(normalizePartnerTrialSimulationDay(30.9), 30);
  assert.equal(normalizePartnerTrialSimulationDay("0"), null);
  assert.equal(normalizePartnerTrialSimulationDay("abc"), null);
});

test("builds simulation timestamps that resolve to the requested trial age", () => {
  const now = new Date("2026-04-27T15:00:00.000Z");
  const simulation = buildPartnerTrialSimulationDates({
    now,
    targetDay: 7,
  });

  assert.equal(
    simulation.trialStartedAt.toISOString(),
    "2026-04-21T15:00:00.000Z",
  );
  assert.equal(
    simulation.trialEndsAt.toISOString(),
    "2026-05-21T15:00:00.000Z",
  );
  assert.equal(
    getPartnerClaimAgeDays(
      {
        trial_started_at: simulation.trialStartedAt,
      },
      now,
    ),
    7,
  );
});

test("supports later lifecycle checkpoints like day 30", () => {
  const now = new Date("2026-04-27T15:00:00.000Z");
  const simulation = buildPartnerTrialSimulationDates({
    now,
    targetDay: 30,
  });

  assert.equal(
    getPartnerClaimAgeDays(
      {
        trial_started_at: simulation.trialStartedAt,
      },
      now,
    ),
    30,
  );
});
