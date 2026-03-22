const COMPETITOR_SPECS = [
  { brand: "booking.com", hostPattern: /(^|\.)booking\.com$/i, textPattern: /\bbooking\s*\.?\s*com\b/i },
  { brand: "expedia", hostPattern: /(^|\.)expedia\.[a-z.]+$/i, textPattern: /\bexpedia\b/i },
  { brand: "hotels.com", hostPattern: /(^|\.)hotels\.com$/i, textPattern: /\bhotels\s*\.?\s*com\b/i },
  { brand: "kayak", hostPattern: /(^|\.)kayak\.[a-z.]+$/i, textPattern: /\bkayak\b/i },
  { brand: "agoda", hostPattern: /(^|\.)agoda\.[a-z.]+$/i, textPattern: /\bagoda\b/i },
  { brand: "trivago", hostPattern: /(^|\.)trivago\.[a-z.]+$/i, textPattern: /\btrivago\b/i },
  { brand: "airbnb", hostPattern: /(^|\.)airbnb\.[a-z.]+$/i, textPattern: /\bairbnb\b/i },
];

const EXPLICIT_WEB_PATTERNS = [
  /\bonline\b/i,
  /\binternet\b/i,
  /\bweb\b/i,
  /\bfuentes?\b/i,
  /\blinks?\b/i,
  /\bsource(?:s)?\b/i,
  /\bgooglea\b/i,
  /\bgoogle\b/i,
  /\bverify\b/i,
  /\bverificar\b/i,
  /\bcheck online\b/i,
  /\bbusca online\b/i,
  /\bbuscar online\b/i,
];

const FRESHNESS_PATTERNS = [
  /\bhoy\b/i,
  /\bahora\b/i,
  /\bactual(?:es)?\b/i,
  /\bactual(?:ly)?\b/i,
  /\bultimo(?:s)?\b/i,
  /\bultimas?\b/i,
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\brecent\b/i,
  /\bnews\b/i,
  /\bupdated?\b/i,
  /\besta semana\b/i,
  /\bthis week\b/i,
  /\bthis weekend\b/i,
  /\beste fin de semana\b/i,
  /\btonight\b/i,
  /\besta noche\b/i,
];

const TEMPORAL_EXTERNAL_PATTERNS = [
  /\bclima\b/i,
  /\bweather\b/i,
  /\btemperatura\b/i,
  /\bforecast\b/i,
  /\beventos?\b/i,
  /\bevents?\b/i,
  /\bhorarios?\b/i,
  /\bschedules?\b/i,
  /\bstatus\b/i,
  /\bopen now\b/i,
  /\babierto(?:s)?\b/i,
  /\bvisa\b/i,
  /\brestricciones?\b/i,
  /\brestrictions?\b/i,
  /\brequirements?\b/i,
  /\bentry rules?\b/i,
  /\bregulaciones?\b/i,
  /\bnormativa\b/i,
];

const CAPABILITY_PATTERNS = [
  /\ben que me pod(?:e|é)s ayudar\b/i,
  /\ben que puedes ayudarme\b/i,
  /\bcomo me pod(?:e|é)s ayudar\b/i,
  /\bque puedes hacer\b/i,
  /\bwhat can you do\b/i,
  /\bhow can you help\b/i,
  /\bhow can you help me\b/i,
  /\bwhat do you do\b/i,
];

const GREETING_ONLY_PATTERNS = [
  /^hola+$/i,
  /^hi+$/i,
  /^hello+$/i,
  /^hey+$/i,
  /^buenas$/i,
  /^buenos dias$/i,
  /^buen dia$/i,
  /^buenas tardes$/i,
  /^buenas noches$/i,
];

const LOCAL_RESULTS_PATTERNS = [
  /\bcual me recomend(?:a|á)s\b/i,
  /\bwhich one do you recommend\b/i,
  /\besas son las unicas opciones\b/i,
  /\bare those the only options\b/i,
  /\bten(?:e|é)s mas hoteles\b/i,
  /\btienes mas hoteles\b/i,
  /\bshow me more\b/i,
  /\bmore options\b/i,
  /\bten(?:e|é)s mas\b/i,
  /\bson las unicas\b/i,
];

const GENERIC_DESTINATION_PATTERNS = [
  /\barmame\b/i,
  /\bplan(?:ea|ear)\b/i,
  /\bque ver\b/i,
  /\bwhat to do\b/i,
  /\bthings to do\b/i,
  /\bcontame sobre\b/i,
  /\btell me about\b/i,
  /\bguide me\b/i,
  /\bitinerario\b/i,
  /\bitinerary\b/i,
];

export const normalizeComparableText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractHostname = (url) => {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
};

const matchAny = (value, patterns = []) => patterns.find((pattern) => pattern.test(value)) || null;

export const userExplicitlyRequestedCompetitor = (value) => {
  const normalized = normalizeComparableText(value);
  return COMPETITOR_SPECS.some((spec) => spec.textPattern.test(normalized));
};

export const decideCall2WebSearch = ({
  toolName = null,
  latestUserMessage = "",
  toolArgs = null,
  state = null,
  userContext = null,
} = {}) => {
  const normalizedMessage = normalizeComparableText(latestUserMessage);
  const allowCompetitorMentions = userExplicitlyRequestedCompetitor(latestUserMessage);
  const resolvedToolName = typeof toolName === "string" ? toolName : "small_talk";
  const destination =
    toolArgs?.destination ||
    toolArgs?.city ||
    userContext?.confirmedSearch?.where ||
    state?.destination?.name ||
    null;

  if (!normalizedMessage) {
    return {
      enabled: false,
      reason: "empty_message",
      trigger: null,
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (matchAny(normalizedMessage, GREETING_ONLY_PATTERNS)) {
    return {
      enabled: false,
      reason: "greeting_only",
      trigger: "greeting_only",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (matchAny(normalizedMessage, CAPABILITY_PATTERNS)) {
    return {
      enabled: false,
      reason: "capability_prompt",
      trigger: "capability_prompt",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (matchAny(normalizedMessage, EXPLICIT_WEB_PATTERNS)) {
    return {
      enabled: true,
      reason: "explicit_web_request",
      trigger: "explicit_web_request",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (
    resolvedToolName === "answer_from_results" &&
    matchAny(normalizedMessage, LOCAL_RESULTS_PATTERNS)
  ) {
    return {
      enabled: false,
      reason: "local_results_question",
      trigger: "local_results_question",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (
    (resolvedToolName === "plan_trip" || resolvedToolName === "get_destination_info") &&
    matchAny(normalizedMessage, GENERIC_DESTINATION_PATTERNS) &&
    !matchAny(normalizedMessage, FRESHNESS_PATTERNS) &&
    !matchAny(normalizedMessage, TEMPORAL_EXTERNAL_PATTERNS)
  ) {
    return {
      enabled: false,
      reason: "generic_destination_request",
      trigger: "generic_destination_request",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  if (
    matchAny(normalizedMessage, FRESHNESS_PATTERNS) ||
    matchAny(normalizedMessage, TEMPORAL_EXTERNAL_PATTERNS)
  ) {
    return {
      enabled: true,
      reason: "current_external_fact",
      trigger: "current_external_fact",
      toolName: resolvedToolName,
      destination,
      allowCompetitorMentions,
    };
  }

  return {
    enabled: false,
    reason: "opt_in_default",
    trigger: null,
    toolName: resolvedToolName,
    destination,
    allowCompetitorMentions,
  };
};

export const filterWebSourcesForPolicy = (sources = [], { allowCompetitors = false } = {}) => {
  const safeSources = [];
  const blockedSources = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    const title = typeof source?.title === "string" ? source.title.trim() : "";
    const url = typeof source?.url === "string" ? source.url.trim() : "";
    if (!url) continue;

    if (allowCompetitors) {
      safeSources.push({ title, url });
      continue;
    }

    const hostname = extractHostname(url);
    const normalizedTitle = normalizeComparableText(title);
    const matchedSpec = COMPETITOR_SPECS.find(
      (spec) =>
        (hostname && spec.hostPattern.test(hostname)) ||
        (normalizedTitle && spec.textPattern.test(normalizedTitle))
    );

    if (matchedSpec) {
      blockedSources.push({
        title,
        url,
        hostname,
        brand: matchedSpec.brand,
      });
      continue;
    }

    safeSources.push({ title, url });
  }

  return { safeSources, blockedSources };
};

export const detectCompetitorMentionsInText = (text = "", { allowCompetitors = false } = {}) => {
  if (allowCompetitors) return [];
  const normalized = normalizeComparableText(text);
  if (!normalized) return [];
  return COMPETITOR_SPECS.filter((spec) => spec.textPattern.test(normalized)).map(
    (spec) => spec.brand
  );
};

export const assessWebSearchResult = ({
  text = "",
  sources = [],
  allowCompetitors = false,
} = {}) => {
  const { safeSources, blockedSources } = filterWebSourcesForPolicy(sources, {
    allowCompetitors,
  });
  const blockedMentions = detectCompetitorMentionsInText(text, {
    allowCompetitors,
  });

  if (blockedSources.length > 0) {
    return {
      accepted: false,
      reason: "blocked_source",
      safeSources: [],
      blockedSources,
      blockedMentions,
    };
  }

  if (blockedMentions.length > 0) {
    return {
      accepted: false,
      reason: "blocked_text_mention",
      safeSources: [],
      blockedSources: [],
      blockedMentions,
    };
  }

  return {
    accepted: true,
    reason: "accepted",
    safeSources,
    blockedSources: [],
    blockedMentions: [],
  };
};
