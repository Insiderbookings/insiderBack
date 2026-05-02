const OPTIONAL_PHONE_PATTERN = /^\+?[0-9\s\-()]{8,25}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const normalizeOptionalPhoneInput = (value) => {
  const trimmed = String(value || "").trim();
  return trimmed || null;
};

export const normalizePhoneDigits = (value) => {
  const raw = normalizeOptionalPhoneInput(value);
  if (!raw) return "";
  return raw.replace(/\D/g, "");
};

export const normalizePhoneE164 = (value) => {
  const raw = normalizeOptionalPhoneInput(value);
  if (!raw) return null;
  const compact = raw.replace(/[\s\-()]/g, "");
  if (!compact.startsWith("+")) return null;
  const normalized = `+${compact.slice(1).replace(/\D/g, "")}`;
  return E164_PATTERN.test(normalized) ? normalized : null;
};

export const isPlausiblePhoneInput = (value) => {
  const raw = normalizeOptionalPhoneInput(value);
  if (!raw) return false;
  if (!OPTIONAL_PHONE_PATTERN.test(raw)) return false;
  const digits = normalizePhoneDigits(raw);
  return digits.length >= 8 && digits.length <= 15;
};

export const resolveStoredPhone = (value) => {
  const raw = normalizeOptionalPhoneInput(value);
  if (!raw) {
    return { phone: null, phoneE164: null };
  }
  const phoneE164 = normalizePhoneE164(raw);
  return {
    phone: phoneE164 || raw,
    phoneE164,
  };
};

export const samePhoneIdentity = (left, right) => {
  const leftE164 = normalizePhoneE164(left);
  const rightE164 = normalizePhoneE164(right);
  if (leftE164 || rightE164) {
    return Boolean(leftE164) && leftE164 === rightE164;
  }
  return normalizeOptionalPhoneInput(left) === normalizeOptionalPhoneInput(right);
};

export const maskPhone = (value) => {
  const raw = normalizeOptionalPhoneInput(value);
  if (!raw) return "your phone number";
  const digits = normalizePhoneDigits(raw);
  if (!digits) return "your phone number";
  if (digits.length <= 4) return `+${digits}`;
  return `+${digits.slice(0, 2)}******${digits.slice(-2)}`;
};
