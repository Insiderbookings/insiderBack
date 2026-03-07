/**
 * AI Chat – content moderation (offensive / inappropriate language).
 * Used before persisting user messages and before calling OpenAI.
 * List-based detection (EN/ES/PT); can be extended with OpenAI Moderation API later.
 */

const CONTENT_NOT_ALLOWED_CODE = "AI_CONTENT_NOT_ALLOWED";

// Terms and phrases (lowercase, no diacritics for matching). Add with care to avoid false positives.
const OFFENSIVE_PATTERNS = [
  // English
  /\bfuck\b/i,
  /\bshit\b/i,
  /\bbitch\b/i,
  /\bcunt\b/i,
  /\basshole\b/i,
  /\bidiot\b/i,
  /\bstupid\b/i,
  /\bkill\s+yourself\b/i,
  /\bnazi\b/i,
  /\bterrorist\b/i,
  /\bhate\b/i,
  /\bdumb\s+ass\b/i,
  /\bmother\s*fucker\b/i,
  /\bslut\b/i,
  /\bwhore\b/i,
  // Spanish (common offensive terms)
  /\bputa\b/i,
  /\bputo\b/i,
  /\bcoño\b/i,
  /\bcarajo\b/i,
  /\bmierda\b/i,
  /\bverga\b/i,
  /\bpelotudo\b/i,
  /\bboludo\b/i,
  /\bconcha\b/i,
  /\bforro\b/i,
  /\bestúpido\b/i,
  /\bidiota\b/i,
  /\bmatate\b/i,
  /\bmatarte\b/i,
  // Portuguese
  /\bporra\b/i,
  /\bcaralho\b/i,
  /\bmerda\b/i,
  /\bputa\b/i,
  /\bputo\b/i,
  /\bestupido\b/i,
  /\bidiota\b/i,
  /\bimbecil\b/i,
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

/**
 * Check if the message contains offensive or prohibited content.
 * @param {string} message - User message to check
 * @returns {{ allowed: boolean, code?: string }} allowed false if content should be rejected
 */
export function isContentAllowed(message) {
  if (typeof message !== "string") return { allowed: true };
  const trimmed = message.trim();
  if (!trimmed) return { allowed: true };
  const normalized = normalizeForMatch(trimmed);

  for (const pattern of OFFENSIVE_PATTERNS) {
    if (pattern.test(trimmed) || pattern.test(normalized)) {
      return { allowed: false, code: CONTENT_NOT_ALLOWED_CODE };
    }
  }
  return { allowed: true };
}

export { CONTENT_NOT_ALLOWED_CODE };
