const toSafeString = (value) => {
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

export const logAiEvent = (label, payload = {}) => {
  const safePayload = payload && typeof payload === "object" ? payload : { value: payload };
  console.log(`[ai] ${label}`, toSafeString(safePayload));
};
