const asBool = (value) => {
  if (value === true || value === false) return value;
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const resolveMetadata = (profileInput = {}) => {
  const profile = asObject(profileInput);
  const nestedMetadata = asObject(profile.metadata);
  if (Object.keys(nestedMetadata).length) return nestedMetadata;
  if (Object.prototype.hasOwnProperty.call(profile, "metadata")) return {};
  return profile;
};

export const isInfluencerIdentityVerified = (profileInput = {}) => {
  const profile = asObject(profileInput);
  const metadata = resolveMetadata(profile);
  const influencerOnboarding = asObject(
    metadata.influencerOnboarding || metadata.influencer_onboarding
  );

  return Boolean(
    asBool(profile.identity_verified) ||
      asBool(profile.identityVerified) ||
      asBool(metadata.identityVerified) ||
      asBool(metadata.identity_verified) ||
      asBool(influencerOnboarding.verifyIdentity) ||
      asBool(influencerOnboarding.identityVerified)
  );
};

export const buildInfluencerOnboardingState = (profileInput = {}) => {
  const verified = isInfluencerIdentityVerified(profileInput);
  return {
    completed: verified,
    pendingCount: verified ? 0 : 1,
    steps: {
      verifyIdentity: verified,
    },
    required: [
      {
        key: "verifyIdentity",
        title: "Verify your identity",
        completed: verified,
        required: true,
      },
    ],
  };
};

export const ensureInfluencerOnboardingMetadata = (profileInput = {}) => {
  const profile = asObject(profileInput);
  const metadata = resolveMetadata(profile);
  const onboarding = buildInfluencerOnboardingState(profile);

  return {
    ...metadata,
    influencerOnboarding: {
      verifyIdentity: onboarding.steps.verifyIdentity,
    },
  };
};
