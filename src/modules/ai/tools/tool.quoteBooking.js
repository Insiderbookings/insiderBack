export const quoteBooking = async () => {
  const error = new Error("Quote flow is not wired yet.");
  error.code = "AI_QUOTE_NOT_IMPLEMENTED";
  throw error;
};
