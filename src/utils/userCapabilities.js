const toInt = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeRoleCodes = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toInt(entry))
    .filter((entry) => Number.isFinite(entry));
};

const hasHostProfile = (user) => {
  const profile = user?.hostProfile ?? user?.host_profile ?? null;
  if (!profile) return false;
  if (profile === true) return true;
  if (typeof profile === "object") return true;
  return Boolean(profile);
};

const hasInfluencerCode = (user) => {
  const code = String(user?.user_code ?? user?.userCode ?? "").trim();
  return Boolean(code);
};

export const ROLE_CODES = Object.freeze({
  USER: 0,
  STAFF: 1,
  INFLUENCER: 2,
  CORPORATE: 3,
  AGENCY: 4,
  OPERATOR: 5,
  HOST: 6,
  ADMIN: 100,
});

export const deriveRoleCodes = (user) => {
  const roleSet = new Set(normalizeRoleCodes(user?.roleCodes ?? user?.role_codes ?? []));
  const role = toInt(user?.role);
  if (Number.isFinite(role)) {
    roleSet.add(role);
  }

  if (hasHostProfile(user)) {
    roleSet.add(ROLE_CODES.HOST);
  }

  if (hasInfluencerCode(user)) {
    roleSet.add(ROLE_CODES.INFLUENCER);
  }

  return Array.from(roleSet.values()).sort((a, b) => a - b);
};

export const hasRoleCode = (user, roleCode) => {
  const code = toInt(roleCode);
  if (!Number.isFinite(code)) return false;
  return deriveRoleCodes(user).includes(code);
};

export const hasAnyRoleCode = (user, allowed = []) => {
  const allowedCodes = normalizeRoleCodes(allowed);
  if (!allowedCodes.length) return false;
  const roleSet = new Set(deriveRoleCodes(user));
  return allowedCodes.some((role) => roleSet.has(role));
};

export const resolveMatchedRoleCode = (user, allowed = []) => {
  const allowedCodes = normalizeRoleCodes(allowed);
  if (!allowedCodes.length) return null;
  const roleSet = new Set(deriveRoleCodes(user));
  for (const role of allowedCodes) {
    if (roleSet.has(role)) return role;
  }
  return null;
};

