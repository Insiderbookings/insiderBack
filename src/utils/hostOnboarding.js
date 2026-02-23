const HOST_ONBOARDING_STEPS = [
  {
    key: "verifyIdentity",
    title: "Verify your identity",
    required: true,
  },
  {
    key: "confirmRealPerson",
    title: "Help us confirm it is really you",
    required: true,
  },
  {
    key: "confirmPhone",
    title: "Confirm your phone number",
    required: false,
  },
];

const asBool = (value) => {
  if (value === true || value === false) return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const safeObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const buildHostOnboardingState = (metadataInput = {}) => {
  const metadata = safeObject(metadataInput);
  const hostOnboarding = safeObject(metadata.hostOnboarding || metadata.host_onboarding);
  const kycStatus = String(metadata.kyc_status || metadata.kycStatus || "").toUpperCase();

  const steps = {
    verifyIdentity: Boolean(
      asBool(hostOnboarding.verifyIdentity) ||
        asBool(hostOnboarding.identityVerified) ||
        asBool(metadata.identityVerified) ||
        asBool(metadata.identity_verified) ||
        kycStatus === "APPROVED"
    ),
    confirmRealPerson: Boolean(
      asBool(hostOnboarding.confirmRealPerson) ||
        asBool(hostOnboarding.realPersonConfirmed) ||
        asBool(metadata.realPersonConfirmed) ||
        asBool(metadata.real_person_confirmed) ||
        asBool(metadata.emailVerified) ||
        asBool(metadata.email_verified)
    ),
    confirmPhone: Boolean(
      asBool(hostOnboarding.confirmPhone) ||
        asBool(hostOnboarding.phoneVerified) ||
        asBool(metadata.phoneVerified) ||
        asBool(metadata.phone_verified)
    ),
  };

  const required = HOST_ONBOARDING_STEPS.map((item) => ({
    key: item.key,
    title: item.title,
    completed: Boolean(steps[item.key]),
    required: item.required !== false,
  }));
  const pendingCount = required.filter((item) => item.required && !item.completed).length;
  const completed = pendingCount === 0;

  return {
    completed,
    pendingCount,
    steps,
    required,
  };
};

export const ensureHostOnboardingMetadata = (metadataInput = {}) => {
  const metadata = safeObject(metadataInput);
  const state = buildHostOnboardingState(metadata);
  return {
    ...metadata,
    hostOnboarding: {
      verifyIdentity: state.steps.verifyIdentity,
      confirmRealPerson: state.steps.confirmRealPerson,
      confirmPhone: state.steps.confirmPhone,
    },
  };
};
