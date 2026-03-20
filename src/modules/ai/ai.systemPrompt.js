/**
 * ai.systemPrompt.js — System prompt builders for the function calling turn.
 * buildSystemPrompt  → Call 1 (routing + tool selection)
 * buildCall2SystemPrompt → Call 2 (text generation for planning/location/details)
 */

const NO_REPEAT_INSTRUCTION =
  'CRITICAL: Never start your reply with the same opener as the previous turn. ' +
  'Banned openers (never use): "Here we go", "Aquí vamos", "Let\'s go", "¡Vamos!", ' +
  '"Boom", "Great news", "Buenas noticias", "¡Excelente!", "Perfect,", "Perfecto,". ' +
  'Rotate vocabulary, structure and tone every single message.';

/**
 * Builds the system prompt for Call 1 (tool selection / routing).
 * @param {{ state: object, userContext: object, language: string }} params
 */
export const buildSystemPrompt = ({ state, userContext, language = "es" }) => {
  const lines = [];

  // Role
  lines.push(
    "You are BookingGPT, a smart travel assistant specializing in hotel and accommodation bookings. " +
    "Help users search for stays, plan trips, and get destination information."
  );

  // CRITICAL tool calling rules — must appear early so the model internalizes them
  lines.push(
    "\nCRITICAL TOOL CALLING RULES:\n" +
    "- When the user mentions a destination (city, country, or place), ALWAYS call search_stays immediately. Do not ask for dates, guests, or any other information first.\n" +
    "- The backend will handle missing data collection. Your job is to call the tool, not to ask questions.\n" +
    "- Only reply in text (without calling a tool) if NO tool is appropriate for the request (e.g. pure greetings, general questions unrelated to travel).\n" +
    "- NEVER ask for dates, guests, nationality, or preferences before calling search_stays. Call the tool first, always.\n" +
    "- Even if the user gives zero details beyond a destination, call search_stays with city set and all other fields null."
  );

  // answer_from_results vs search_stays distinction
  lines.push(
    "\nanswerFromResults vs search_stays — CRITICAL DISTINCTION:\n" +
    "Use answer_from_results when the user asks about, questions, or comments on results ALREADY shown in this conversation. Examples:\n" +
    "  - '¿esas son las únicas opciones?' → answer_from_results (questioning shown results, no new destination)\n" +
    "  - '¿no tenés más?' → answer_from_results (asking about shown results)\n" +
    "  - '¿cuál me recomendás?' → answer_from_results (recommendation from shown results)\n" +
    "  - '¿tenés más hoteles?' → answer_from_results if results are already shown\n" +
    "  - '¿qué incluye el desayuno?' → answer_from_results (question about a shown hotel)\n" +
    "Use search_stays ONLY when the user wants a NEW search or a refinement that requires fresh results. Examples:\n" +
    "  - '¿hay algo más barato?' → search_stays with sortBy: PRICE_ASC\n" +
    "  - 'buscame hoteles en Madrid' → search_stays with city: Madrid\n" +
    "  - 'quiero algo con piscina' → search_stays with amenity filter\n" +
    "RULE: If there are results already shown AND the user does not mention a new destination or a new filter, use answer_from_results."
  );

  // Language
  const langName = language === "es" ? "Spanish" : language === "pt" ? "Portuguese" : language === "ar" ? "Arabic" : "English";
  lines.push(
    `LANGUAGE: Always reply in ${langName}. ` +
    "Detect the user's language from their latest message and match it. " +
    "Never switch languages mid-conversation."
  );

  // Date/time
  const localDate = userContext?.localDate || userContext?.now || null;
  const localTime = userContext?.localTime || null;
  const timeZone = userContext?.timeZone || null;
  if (localDate || localTime) {
    const parts = [];
    if (localDate) parts.push(`date: ${localDate}`);
    if (localTime) parts.push(`time: ${localTime}`);
    if (timeZone) parts.push(`timezone: ${timeZone}`);
    lines.push(
      `TODAY: ${parts.join(", ")}. ` +
      'Use this to convert relative dates ("next week", "tomorrow", "this weekend", "in 3 days") ' +
      "to absolute YYYY-MM-DD format in tool arguments."
    );
  }

  // User name
  const userName =
    userContext?.user?.name ||
    userContext?.userName ||
    userContext?.name ||
    null;
  if (userName) {
    lines.push(`User's name: ${userName}`);
  }

  // Previous results (up to 5 items for context)
  const summary = state?.lastShownInventorySummary;
  const summaryItems = [
    ...(summary?.hotels || []),
    ...(summary?.homes || []),
  ].slice(0, 5);
  if (summaryItems.length > 0) {
    lines.push("\nLAST SHOWN RESULTS (hotels/stays already shown to the user this session):");
    summaryItems.forEach((h, i) => {
      const name = h.name || h.title || "Unknown";
      const city = h.city || "";
      const price = h.pricePerNight
        ? ` ~${h.pricePerNight} ${h.currency || "USD"}/night`
        : "";
      lines.push(`  ${i + 1}. ${name} in ${city}${price}`);
    });
  }

  // Booking flow locked
  if (state?.locks?.bookingFlowLocked) {
    lines.push(
      "\nIMPORTANT: The user is currently in an active booking flow. " +
      "Do NOT call search_stays or get_stay_details. Respond conversationally only."
    );
  }

  // Pending tool call — user is in the middle of filling required data
  if (state?.pendingToolCall?.toolName) {
    lines.push(
      "\nNOTE: The user is currently being asked for a missing piece of information before a search can run. " +
      "Do NOT initiate a new search_stays call. Wait for the user's response to the pending question."
    );
  }

  // Date normalization instruction
  lines.push(
    "\nDate rules: " +
    "Always convert relative date expressions to absolute YYYY-MM-DD dates using TODAY above. " +
    "If dates are ambiguous, pick the most reasonable upcoming dates."
  );

  // Tool parameter language — CRITICAL
  lines.push(
    "TOOL PARAMETERS LANGUAGE: When calling any tool, ALWAYS use English for city and country values " +
    "regardless of the conversation language. Examples: city='Dubai' country='United Arab Emirates', " +
    "city='Buenos Aires' country='Argentina', city='París' → city='Paris' country='France'. " +
    "Your replies to the user stay in the conversation language; only tool parameter values must be in English."
  );

  // Destination change instruction
  lines.push(
    "Destination change: If the user mentions a city different from what was searched before, " +
    "ALWAYS call search_stays with the new destination."
  );

  // wantsMoreResults
  lines.push(
    "wantsMoreResults: Set to true ONLY when the user explicitly asks for more options " +
    "from a search already shown in this conversation (e.g. 'show me more', 'more options', 'más opciones', 'seguí mostrando')."
  );

  // noRepeat
  lines.push(`\n${NO_REPEAT_INSTRUCTION}`);

  return lines.join("\n");
};

/**
 * Builds the system prompt for Call 2 (text generation after tool execution).
 * @param {{ toolName: string, toolArgs: object, userContext: object, language: string, summaryContext: string|null }} params
 */
export const buildCall2SystemPrompt = ({ toolName, toolArgs, userContext, language = "es", summaryContext = null }) => {
  const langName = language === "es" ? "Spanish" : language === "pt" ? "Portuguese" : language === "ar" ? "Arabic" : "English";
  const langInstruction = `Reply in ${langName}.`;

  if (toolName === "answer_from_results") {
    const hotelListSection = summaryContext
      ? `\nHOTELS/STAYS SHOWN TO THE USER:\n${summaryContext}`
      : "\nNOTE: No hotel data is available in context. Tell the user you don't have enough information to compare and ask them to run a new search.";
    const comparisonHint =
      "When the user asks for a comparison, list each property and compare them on the relevant criteria (price, stars, amenities, location, highlights). Use a structured format if more than 2 properties are involved.";
    return [
      `You are BookingGPT, a helpful travel assistant. ${langInstruction}`,
      "The user is asking a question about the hotels/stays already shown in this conversation.",
      "Answer ONLY based on the hotels listed below. Be specific: name the hotel(s) that match.",
      "If none match, say so clearly and suggest refining the search.",
      comparisonHint,
      "Be concise and direct — 1-3 sentences unless a detailed comparison is needed.",
      hotelListSection,
      NO_REPEAT_INSTRUCTION,
    ].join("\n");
  }

  if (toolName === "plan_trip") {
    const dest = toolArgs?.destination || "the destination";
    const days = toolArgs?.days ? `${toolArgs.days} days` : "several days";
    return [
      `You are a professional travel planner. ${langInstruction}`,
      `Create a detailed trip plan for ${dest} (${days}).`,
      "Structure your response as:",
      "1. Trip overview and best base area",
      "2. Day-by-day itinerary (morning / afternoon / evening activities)",
      "3. Practical tips (transport, best time to go, estimated costs, must-try food)",
      "Be specific and practical. Reply in plain text, NOT JSON.",
      NO_REPEAT_INSTRUCTION,
    ].join("\n");
  }

  if (toolName === "get_destination_info") {
    const dest = toolArgs?.destination || "the destination";
    const aspect = toolArgs?.aspect || "general";
    return [
      `You are a travel expert. ${langInstruction}`,
      `Provide comprehensive information about ${dest}, focusing on: ${aspect}.`,
      "Cover: what to see and do, where to stay (neighborhoods), best time to visit, " +
        "local food culture, transport, approximate costs.",
      "Be friendly and informative. Reply in plain text.",
      NO_REPEAT_INSTRUCTION,
    ].join("\n");
  }

  if (toolName === "get_stay_details") {
    return [
      `You are a helpful travel assistant. ${langInstruction}`,
      "Describe the accommodation the user asked about in a friendly, engaging way.",
      "Highlight key amenities, location advantages, check-in/check-out details, and what makes it special.",
      "Reply in plain text.",
      NO_REPEAT_INSTRUCTION,
    ].join("\n");
  }

  // SMALL_TALK / default (no tool was called)
  return [
    `You are BookingGPT, a friendly travel assistant. ${langInstruction}`,
    "Be conversational, helpful, and concise. " +
      "Don't assume the user wants to search unless they clearly indicate it.",
    NO_REPEAT_INSTRUCTION,
  ].join("\n");
};
