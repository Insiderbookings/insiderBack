/**
 * AI Chat – content moderation (offensive / inappropriate language).
 * Two-layer approach:
 * 1. Fast regex check for unambiguously offensive terms (no false positives)
 * 2. OpenAI Moderation API for nuanced detection (async, free endpoint)
 */
import OpenAI from "openai";

const CONTENT_NOT_ALLOWED_CODE = "AI_CONTENT_NOT_ALLOWED";

// Only unambiguously offensive terms — removed false-positive-prone words like
// "hate", "idiot", "stupid", "nazi", "terrorist" which appear in legitimate contexts
const OFFENSIVE_PATTERNS = [
  // English — sexual/violent slurs only
  /\bfuck\b/i,
  /\bshit\b/i,
  /\bcunt\b/i,
  /\basshole\b/i,
  /\bmother\s*fucker\b/i,
  /\bslut\b/i,
  /\bwhore\b/i,
  /\bkill\s+yourself\b/i,
  /\bdumb\s*ass\b/i,
  // Spanish — sexual slurs only (not regional expletives used casually like "boludo")
  /\bputa\s+madre\b/i,
  /\bputo\s+culo\b/i,
  /\bcoño\b/i,
  /\bverga\b/i,
  /\bmatate\b/i,
  /\bmatarte\b/i,
  // Portuguese
  /\bporra\b/i,
  /\bcaralho\b/i,
  /\bvagabunda\b/i,
  /\bvagabundo\b/i,
];

/**
 * Normalize text for matching: NFD, strip diacritics, collapse spaces.
 */
function normalizeForMatch(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

let _openaiClient = null;
function getOpenAI() {
  if (!_openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    _openaiClient = new OpenAI({ apiKey });
  }
  return _openaiClient;
}

/**
 * Fast regex pre-check. Synchronous, zero latency.
 */
function checkRegex(message) {
  const normalized = normalizeForMatch(message);
  for (const pattern of OFFENSIVE_PATTERNS) {
    if (pattern.test(message) || pattern.test(normalized)) {
      return false;
    }
  }
  return true;
}

/**
 * OpenAI Moderation API check. Free, fast (~150-300ms), accurate.
 * Returns true (allowed) if check fails or OpenAI is unavailable.
 */
async function checkOpenAIModeration(message) {
  const openai = getOpenAI();
  if (!openai) return true; // Skip if no API key configured
  try {
    const response = await openai.moderations.create({ input: message });
    const result = response?.results?.[0];
    if (!result) return true;
    return !result.flagged;
  } catch (err) {
    // Moderation API failure is non-blocking — allow message through
    console.warn("[ai] moderation API check failed (non-blocking)", err?.message);
    return true;
  }
}

/**
 * Check if the message contains offensive or prohibited content.
 * @param {string} message - User message to check
 * @returns {Promise<{ allowed: boolean, code?: string }>}
 */
export async function isContentAllowed(message) {
  if (typeof message !== "string") return { allowed: true };
  const trimmed = message.trim();
  if (!trimmed) return { allowed: true };

  // Layer 1: fast regex (zero latency)
  if (!checkRegex(trimmed)) {
    return { allowed: false, code: CONTENT_NOT_ALLOWED_CODE };
  }

  // Layer 2: OpenAI Moderation API (async, free, accurate)
  const openAiAllowed = await checkOpenAIModeration(trimmed);
  if (!openAiAllowed) {
    return { allowed: false, code: CONTENT_NOT_ALLOWED_CODE };
  }

  return { allowed: true };
}

export { CONTENT_NOT_ALLOWED_CODE };
