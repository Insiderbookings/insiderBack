import { NEXT_ACTIONS, INTENTS } from "./ai.planner.js";

export const enforcePolicy = ({ state, intent, nextAction }) => {
  if (!state?.locks?.bookingFlowLocked) {
    return { intent, nextAction, policyNotice: null };
  }

  if (intent === INTENTS.SEARCH) {
    return {
      intent: INTENTS.HELP,
      nextAction: NEXT_ACTIONS.HELP,
      policyNotice: "BOOKING_LOCKED",
    };
  }

  return { intent, nextAction, policyNotice: "BOOKING_LOCKED" };
};
