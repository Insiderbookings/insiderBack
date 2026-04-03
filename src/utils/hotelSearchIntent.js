const normalizeToken = (value) => String(value || "").trim().toLowerCase()

export const resolveEffectiveSearchIntent = ({
  requestedIntent = null,
  rawSearchMode = "",
  resolvedCityCode = null,
  manualHotelName = null,
  hasStrongHotelNameSignal = false,
}) => {
  if (requestedIntent && requestedIntent !== "mixed") {
    return requestedIntent
  }

  const normalizedSearchMode = normalizeToken(rawSearchMode)
  const hasCityAnchor = Boolean(String(resolvedCityCode || "").trim())
  const hasManualHotelName = Boolean(String(manualHotelName || "").trim())
  const hasExplicitHotelSignal = requestedIntent === "hotel" || hasManualHotelName

  if (normalizedSearchMode === "city") {
    return "city"
  }

  if (hasCityAnchor && !hasExplicitHotelSignal) {
    return "city"
  }

  return hasStrongHotelNameSignal ? "hotel" : "city"
}
