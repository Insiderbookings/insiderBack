import dayjs from "dayjs";

import { PARTNER_TRIAL_DAYS } from "./partnerCatalog.service.js";

export const PARTNER_TRIAL_SIMULATION_MIN_DAY = 1;
export const PARTNER_TRIAL_SIMULATION_MAX_DAY = Math.max(PARTNER_TRIAL_DAYS + 30, 90);

export const normalizePartnerTrialSimulationDay = (
  value,
  {
    min = PARTNER_TRIAL_SIMULATION_MIN_DAY,
    max = PARTNER_TRIAL_SIMULATION_MAX_DAY,
  } = {},
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.trunc(numeric);
  if (rounded < min || rounded > max) return null;
  return rounded;
};

export const buildPartnerTrialSimulationDates = ({
  now = new Date(),
  targetDay,
  trialDays = PARTNER_TRIAL_DAYS,
} = {}) => {
  const normalizedDay = normalizePartnerTrialSimulationDay(targetDay, {
    max: Math.max(Number(trialDays) || PARTNER_TRIAL_DAYS, PARTNER_TRIAL_DAYS) + 60,
  });
  if (!normalizedDay) {
    const error = new Error(
      `targetDay must be an integer between ${PARTNER_TRIAL_SIMULATION_MIN_DAY} and ${PARTNER_TRIAL_SIMULATION_MAX_DAY}`,
    );
    error.status = 400;
    throw error;
  }

  const referenceNow = dayjs(now);
  if (!referenceNow.isValid()) {
    const error = new Error("A valid simulation date is required");
    error.status = 400;
    throw error;
  }

  const safeTrialDays = Math.max(1, Math.trunc(Number(trialDays) || PARTNER_TRIAL_DAYS));
  const trialStartedAt = referenceNow.subtract(normalizedDay - 1, "day").toDate();
  const trialEndsAt = dayjs(trialStartedAt).add(safeTrialDays, "day").toDate();

  return {
    targetDay: normalizedDay,
    claimedAt: trialStartedAt,
    trialStartedAt,
    trialEndsAt,
  };
};
