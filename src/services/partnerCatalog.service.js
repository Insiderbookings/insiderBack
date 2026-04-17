import dayjs from "dayjs";

export const PARTNER_TRIAL_DAYS = 30;
export const PARTNER_PRICE_DISCLOSURE_DAY = 25;
export const PARTNER_INQUIRY_CTA_LABEL = "Send inquiry";

export const PARTNER_RESPONSE_TIME_OPTIONS = Object.freeze([
  {
    code: "one_hour",
    label: "Replies in about 1 hour",
    shortLabel: "About 1 hour",
    sortOrder: 1,
  },
  {
    code: "three_hours",
    label: "Replies in about 3 hours",
    shortLabel: "About 3 hours",
    sortOrder: 2,
  },
  {
    code: "same_day",
    label: "Replies the same day",
    shortLabel: "Same day",
    sortOrder: 3,
  },
  {
    code: "within_day",
    label: "Replies within 24 hours",
    shortLabel: "Within 24 hours",
    sortOrder: 4,
  },
]);

export const PARTNER_BADGES = Object.freeze({
  verified: {
    code: "verified",
    label: "Verified",
    color: "Green",
    hex: "#22C55E",
    priority: 1,
  },
  preferred: {
    code: "preferred",
    label: "Preferred",
    color: "Blue",
    hex: "#1877F2",
    priority: 2,
  },
  featured: {
    code: "featured",
    label: "Featured",
    color: "Purple",
    hex: "#7B2FBE",
    priority: 3,
  },
});

export const PARTNER_PLANS = Object.freeze({
  verified: {
    code: "verified",
    label: "Verified",
    priceMonthly: 49,
    currency: "USD",
    badgeCode: "verified",
    billingMode: "subscription",
    legacyCodes: ["starter"],
    stripePriceEnvs: ["STRIPE_PARTNER_PRICE_VERIFIED", "STRIPE_PARTNER_PRICE_STARTER"],
    features: [
      "Verified badge on hotel card in app",
      "Listed in BookingGPT search results",
      "Basic profile: photos, description, amenities and contact",
      "Weekly stats email with BookingGPT Reach and clicks",
    ],
  },
  preferred: {
    code: "preferred",
    label: "Preferred",
    priceMonthly: 99,
    currency: "USD",
    badgeCode: "preferred",
    billingMode: "subscription",
    legacyCodes: ["pro"],
    stripePriceEnvs: ["STRIPE_PARTNER_PRICE_PREFERRED", "STRIPE_PARTNER_PRICE_PRO"],
    features: [
      "Everything in Verified",
      "Ranks above Verified hotels in search",
      "Full profile editor",
      "Booking inquiry button",
      "Response time badge on listing",
      "Special offers line on listing",
      "Included in BookingGPT destination emails",
    ],
  },
  featured: {
    code: "featured",
    label: "Featured",
    priceMonthly: 249,
    currency: "USD",
    badgeCode: "featured",
    billingMode: "subscription",
    legacyCodes: ["elite"],
    stripePriceEnvs: ["STRIPE_PARTNER_PRICE_FEATURED", "STRIPE_PARTNER_PRICE_ELITE"],
    features: [
      "Everything in Preferred",
      "Top of all search results",
      "Monthly PDF performance report",
      "Dedicated account manager",
      "Review boost for post-stay Google review prompt",
      "Competitor insights by city averages",
      "Upsell capability with no BookingGPT fee",
    ],
  },
});

export const PARTNER_EMAIL_SEQUENCE = Object.freeze([
  {
    key: "day_1_welcome",
    day: 1,
    subject: "Your Featured badge is live on BookingGPT",
    preview: "Welcome. Your Featured badge is live. Here is your dashboard link.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_7_report",
    day: 7,
    subject: "Week 1 report for your BookingGPT trial",
    preview: "Week 1 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_14_report",
    day: 14,
    subject: "Week 2 report for your BookingGPT trial",
    preview: "Week 2 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_15_midpoint",
    day: 15,
    subject: "You are halfway through your trial",
    preview: "You are halfway through your trial. Here is what you have gotten so far.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_21_report",
    day: 21,
    subject: "Week 3 report for your BookingGPT trial",
    preview: "Week 3 report. Your views and clicks this week.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_25_choose_plan",
    day: 25,
    subject: "Your trial ends in 5 days",
    preview: "Choose your plan to keep your badge.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_27_urgent",
    day: 27,
    subject: "3 days left before your badge disappears",
    preview: "Your badge disappears soon. A manual call is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_28_final_warning",
    day: 28,
    subject: "Tomorrow your badge disappears",
    preview: "Last chance before removal. A second call attempt is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_30_removed",
    day: 30,
    subject: "Your badge has been removed",
    preview: "Restore it here. A third call attempt is scheduled too.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_32_restore",
    day: 32,
    subject: "Your hotel is still on BookingGPT without a badge",
    preview: "Restore it to get visibility back.",
    stopWhenSubscribed: true,
  },
  {
    key: "day_37_last_message",
    day: 37,
    subject: "Final message about restoring your badge",
    preview: "Last call and final message before we stop follow-ups.",
    stopWhenSubscribed: true,
  },
]);

export const PARTNER_PAYMENT_METHODS = Object.freeze({
  card: "card",
  invoice: "invoice",
});

export const PARTNER_CLAIM_STATUSES = Object.freeze({
  trialActive: "TRIAL_ACTIVE",
  trialEnding: "TRIAL_ENDING",
  paymentDue: "PAYMENT_DUE",
  subscribed: "SUBSCRIBED",
  invoicePending: "INVOICE_PENDING",
  expired: "EXPIRED",
  cancelled: "CANCELLED",
});

export const PARTNER_SUBSCRIPTION_STATUSES = Object.freeze({
  active: "active",
  trialing: "trialing",
  pastDue: "past_due",
  unpaid: "unpaid",
  cancelled: "canceled",
  incomplete: "incomplete",
  pendingInvoice: "pending_invoice",
});

const PARTNER_PLAN_LOOKUP = Object.freeze(
  Object.values(PARTNER_PLANS).reduce((acc, plan) => {
    acc[plan.code] = plan;
    for (const legacyCode of plan.legacyCodes || []) acc[legacyCode] = plan;
    return acc;
  }, {}),
);

const PARTNER_RESPONSE_TIME_LOOKUP = Object.freeze(
  PARTNER_RESPONSE_TIME_OPTIONS.reduce((acc, option) => {
    acc[option.code] = option;
    return acc;
  }, {}),
);

const sanitizeText = (value, maxLength = 255) => {
  if (value == null) return null;
  const trimmed = String(value).trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const sanitizeEmail = (value) => {
  const normalized = sanitizeText(value, 150);
  if (!normalized) return null;
  return normalized.toLowerCase();
};

const sanitizeUrl = (value, maxLength = 500) => {
  const normalized = sanitizeText(value, maxLength);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const sanitizeTextBlock = (value, maxLength = 4000) => {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const sanitizeTextListEntry = (value, maxLength = 80) => {
  if (value == null) return null;
  if (typeof value === "object") {
    return sanitizeText(
      value?.name ??
        value?.label ??
        value?.text ??
        value?.description ??
        value?.["#text"] ??
        value?.["@_name"] ??
        null,
      maxLength,
    );
  }
  return sanitizeText(value, maxLength);
};

const sanitizeTextList = (value, { maxItems = 40, itemMaxLength = 80 } = {}) => {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n|,/)
        .map((entry) => entry.trim());
  return Array.from(
    new Set(
      source
        .map((entry) => sanitizeTextListEntry(entry, itemMaxLength))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
};

const normalizeAmenityKey = (value) =>
  sanitizeText(value, 80)
    ?.toLowerCase()
    .replace(/\s+/g, " ")
    .trim() || null;

const sanitizeUrlList = (value, { maxItems = 12, itemMaxLength = 500 } = {}) => {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n|,/)
        .map((entry) => entry.trim());
  return Array.from(
    new Set(
      source
        .map((entry) => sanitizeUrl(entry, itemMaxLength))
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
};

const readHotelTextCandidate = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return sanitizeTextBlock(value, 4000);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = readHotelTextCandidate(entry);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    const keys = [
      "#text",
      "text",
      "description",
      "description1",
      "description2",
      "language",
      "name",
      "label",
      "value",
      "#cdata-section",
    ];
    for (const key of keys) {
      const candidate = readHotelTextCandidate(value?.[key]);
      if (candidate) return candidate;
    }
  }
  return null;
};

const extractHotelDescription = (hotel) => {
  if (!hotel || typeof hotel !== "object") return null;
  const sources = [
    hotel.shortDescription,
    hotel.description,
    hotel.descriptions,
    hotel.raw_payload?.descriptions,
  ];
  for (const source of sources) {
    const candidate = readHotelTextCandidate(source);
    if (candidate) return candidate;
  }
  return null;
};

const collectPhotoCandidates = (value, acc = []) => {
  if (!value) return acc;
  if (typeof value === "string" || typeof value === "number") {
    const normalized = sanitizeUrl(String(value), 500);
    if (normalized) acc.push(normalized);
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPhotoCandidates(entry, acc));
    return acc;
  }
  if (typeof value === "object") {
    const directKeys = ["thumb", "url", "@_url", "#text", "text", "value"];
    directKeys.forEach((key) => {
      if (value?.[key]) collectPhotoCandidates(value[key], acc);
    });
    const nestedKeys = ["photo", "photos", "image", "images", "hotelImage", "hotelImages"];
    nestedKeys.forEach((key) => {
      if (value?.[key]) collectPhotoCandidates(value[key], acc);
    });
  }
  return acc;
};

const collectHotelPhotoUrls = (hotel) => {
  if (!hotel || typeof hotel !== "object") return [];
  const sources = [
    hotel.photos,
    hotel.photo,
    hotel.image,
    hotel.images,
    hotel.images?.hotelImages,
    hotel.images?.image,
    hotel.raw_payload?.images,
  ];
  const urls = [];
  for (const source of sources) {
    collectPhotoCandidates(source, urls);
  }
  return Array.from(new Set(urls)).slice(0, 12);
};

const extractHotelAmenityLabels = (hotel) => {
  if (!hotel || typeof hotel !== "object") return [];
  const normalizedRows = Array.isArray(hotel.hotelAmenities) ? hotel.hotelAmenities : [];
  if (normalizedRows.length) {
    return sanitizeTextList(
      normalizedRows.map((entry) => entry?.item_name ?? entry?.catalog?.name ?? null),
      { maxItems: 40, itemMaxLength: 80 },
    );
  }
  const sources = [
    hotel.amenities,
    hotel.leisure,
    hotel.business,
    hotel.raw_payload?.amenities,
  ];
  const values = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      values.push(...source);
    } else if (source && typeof source === "object") {
      values.push(source);
    }
  }
  return sanitizeTextList(values, { maxItems: 40, itemMaxLength: 80 });
};

export const buildPartnerProfileSnapshotFromHotel = (hotel, contact = {}) => ({
  description: extractHotelDescription(hotel),
  amenities: extractHotelAmenityLabels(hotel),
  photoUrls: collectHotelPhotoUrls(hotel),
  publicContactEmail: sanitizeEmail(contact?.publicContactEmail || contact?.contactEmail),
  publicContactPhone: sanitizeText(contact?.publicContactPhone || contact?.contactPhone, 40),
});

export const resolvePartnerAccountManagerFromClaim = (claim) => {
  const meta =
    claim?.meta && typeof claim.meta === "object" && !Array.isArray(claim.meta) ? claim.meta : {};
  const source =
    meta.accountManager && typeof meta.accountManager === "object" && !Array.isArray(meta.accountManager)
      ? meta.accountManager
      : {};

  const role = sanitizeText(
    source.role || process.env.PARTNERS_ACCOUNT_MANAGER_ROLE || "Dedicated account manager",
    80,
  );
  const name = sanitizeText(
    source.name || process.env.PARTNERS_ACCOUNT_MANAGER_NAME || "BookingGPT Partner Success",
    120,
  );
  const email = sanitizeEmail(
    source.email ||
      process.env.PARTNERS_ACCOUNT_MANAGER_EMAIL ||
      process.env.PARTNERS_INTERNAL_EMAIL ||
      process.env.PARTNERS_EMAIL,
  );
  const phone = sanitizeText(source.phone || process.env.PARTNERS_ACCOUNT_MANAGER_PHONE, 40);
  const calendarUrl = sanitizeUrl(
    source.calendarUrl || process.env.PARTNERS_ACCOUNT_MANAGER_CALENDAR_URL,
    500,
  );
  const note = sanitizeText(
    source.note ||
      process.env.PARTNERS_ACCOUNT_MANAGER_NOTE ||
      "Use this contact for launch help, destination campaigns and badge performance follow-up.",
    220,
  );
  const assignedAt = source.assignedAt || null;
  const assignedByUserId = Number(source.assignedByUserId || 0) || null;

  if (!name && !email && !phone && !calendarUrl) return null;

  return {
    role,
    name,
    email,
    phone,
    calendarUrl,
    note,
    assignedAt,
    assignedByUserId,
  };
};

const resolvePartnerProfileSnapshot = (claim) => {
  const snapshot =
    claim?.profile_snapshot && typeof claim.profile_snapshot === "object" && !Array.isArray(claim.profile_snapshot)
      ? claim.profile_snapshot
      : {};
  const livePhotoUrls = collectHotelPhotoUrls(claim?.hotel);
  const snapshotPhotoUrls = sanitizeUrlList(snapshot.photoUrls, { maxItems: 12, itemMaxLength: 500 });
  const resolvedPhotoUrls =
    snapshotPhotoUrls.length >= livePhotoUrls.length
      ? snapshotPhotoUrls
      : livePhotoUrls;

  return {
    description: sanitizeTextBlock(snapshot.description, 4000) || extractHotelDescription(claim?.hotel),
    amenities: sanitizeTextList(snapshot.amenities, { maxItems: 40, itemMaxLength: 80 }).length
      ? sanitizeTextList(snapshot.amenities, { maxItems: 40, itemMaxLength: 80 })
      : extractHotelAmenityLabels(claim?.hotel),
    photoUrls: resolvedPhotoUrls,
    publicContactEmail:
      sanitizeEmail(snapshot.publicContactEmail || claim?.contact_email),
    publicContactPhone:
      sanitizeText(snapshot.publicContactPhone || claim?.contact_phone, 40),
  };
};

const resolvePartnerAmenityDelta = ({ snapshotAmenities = [], overrides = {} }) => {
  const baseAmenities = sanitizeTextList(snapshotAmenities, { maxItems: 60, itemMaxLength: 80 });
  const hiddenAmenities = sanitizeTextList(overrides.hiddenAmenities, { maxItems: 60, itemMaxLength: 80 });
  const addedAmenities = sanitizeTextList(overrides.addedAmenities, { maxItems: 30, itemMaxLength: 80 });
  const legacyAmenities = sanitizeTextList(overrides.amenities, { maxItems: 60, itemMaxLength: 80 });

  if (legacyAmenities.length && !hiddenAmenities.length && !addedAmenities.length) {
    return {
      baseAmenities,
      hiddenAmenities: [],
      addedAmenities: [],
      effectiveAmenities: legacyAmenities,
      mode: "legacy_replace",
    };
  }

  const hiddenKeys = new Set(hiddenAmenities.map((entry) => normalizeAmenityKey(entry)).filter(Boolean));
  const visibleBaseAmenities = baseAmenities.filter((entry) => {
    const key = normalizeAmenityKey(entry);
    return key ? !hiddenKeys.has(key) : true;
  });

  const effectiveAmenities = Array.from(
    new Set(
      [...visibleBaseAmenities, ...addedAmenities]
        .map((entry) => sanitizeText(entry, 80))
        .filter(Boolean),
    ),
  );

  return {
    baseAmenities,
    hiddenAmenities,
    addedAmenities,
    effectiveAmenities,
    mode: "delta",
  };
};

const resolvePartnerPhotoDelta = ({ snapshotPhotoUrls = [], overrides = {} }) => {
  const basePhotoUrls = sanitizeUrlList(snapshotPhotoUrls, { maxItems: 20, itemMaxLength: 500 });
  const addedPhotoUrls = sanitizeUrlList(
    overrides.addedPhotoUrls ?? overrides.photoUrls,
    { maxItems: 12, itemMaxLength: 500 },
  );
  return {
    basePhotoUrls,
    addedPhotoUrls,
    effectivePhotoUrls: Array.from(new Set([...basePhotoUrls, ...addedPhotoUrls])),
  };
};

export const getPartnerPlanByCode = (code) =>
  PARTNER_PLAN_LOOKUP[String(code || "").trim().toLowerCase()] || null;

export const getPartnerBadgeByCode = (code) =>
  PARTNER_BADGES[String(code || "").trim().toLowerCase()] || null;

export const getPartnerResponseTimeOption = (code) =>
  PARTNER_RESPONSE_TIME_LOOKUP[String(code || "").trim().toLowerCase()] || null;

export const getStripePriceIdForPartnerPlan = (plan) => {
  if (!plan) return null;
  const envNames = Array.isArray(plan.stripePriceEnvs) ? plan.stripePriceEnvs : [];
  for (const envName of envNames) {
    const value = process.env[envName];
    if (value) return value;
  }
  return null;
};

export const getPartnerPlans = () =>
  Object.values(PARTNER_PLANS).map((plan) => ({
    ...plan,
    badge: getPartnerBadgeByCode(plan.badgeCode),
    stripePriceId: getStripePriceIdForPartnerPlan(plan),
  }));

export const resolvePartnerEffectivePlan = (claim, now = new Date()) => {
  const program = resolvePartnerProgramFromClaim(claim, now);
  if (program?.trialActive) return getPartnerPlanByCode("featured");
  if (
    String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.subscribed &&
    claim?.current_plan_code
  ) {
    return getPartnerPlanByCode(claim.current_plan_code);
  }
  if (
    [PARTNER_SUBSCRIPTION_STATUSES.active, PARTNER_SUBSCRIPTION_STATUSES.trialing].includes(
      String(claim?.subscription_status || "").toLowerCase(),
    ) &&
    claim?.current_plan_code
  ) {
    return getPartnerPlanByCode(claim.current_plan_code);
  }
  return null;
};

export const resolvePartnerEditablePlan = (claim, now = new Date()) => {
  const program = resolvePartnerProgramFromClaim(claim, now);
  if (program?.trialActive) return getPartnerPlanByCode("featured");
  const currentPlan = getPartnerPlanByCode(claim?.current_plan_code);
  const pendingPlan = getPartnerPlanByCode(claim?.pending_plan_code);
  return currentPlan || pendingPlan || null;
};

export const resolvePartnerFeatureAccess = (claim, now = new Date()) => {
  const activePlan = resolvePartnerEffectivePlan(claim, now);
  const editablePlan = resolvePartnerEditablePlan(claim, now);
  const activeCode = activePlan?.code || null;
  const editableCode = editablePlan?.code || null;
  const basicVisible = ["verified", "preferred", "featured"].includes(activeCode);
  const basicEditable = ["verified", "preferred", "featured"].includes(editableCode);
  const preferredVisible = ["preferred", "featured"].includes(activeCode);
  const preferredEditable = ["preferred", "featured"].includes(editableCode);

  return {
    activePlanCode: activeCode,
    editablePlanCode: editableCode,
    basicProfileVisible: basicVisible,
    basicProfileEditable: basicEditable,
    bookingInquiryVisible: preferredVisible,
    bookingInquiryEditable: preferredEditable,
    responseTimeVisible: preferredVisible,
    responseTimeEditable: preferredEditable,
    specialOffersVisible: preferredVisible,
    specialOffersEditable: preferredEditable,
    destinationEmailsVisible: preferredVisible,
    destinationEmailsEditable: preferredEditable,
    fullProfileEditorVisible: ["preferred", "featured"].includes(activeCode),
    fullProfileEditorEditable: ["preferred", "featured"].includes(editableCode),
    reviewBoostVisible: activeCode === "featured",
    reviewBoostEditable: editableCode === "featured",
    competitorInsightsVisible: activeCode === "featured",
    competitorInsightsEditable: editableCode === "featured",
    monthlyReportVisible: activeCode === "featured",
    monthlyReportEditable: editableCode === "featured",
    upsellVisible: activeCode === "featured",
    upsellEditable: editableCode === "featured",
  };
};

export const normalizePartnerProfileOverrides = (input = {}, existing = null) => {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};

  if (Object.prototype.hasOwnProperty.call(input, "specialOfferText")) {
    base.specialOfferText = sanitizeText(input.specialOfferText, 140);
  }
  if (Object.prototype.hasOwnProperty.call(input, "responseTimeCode")) {
    base.responseTimeCode = getPartnerResponseTimeOption(input.responseTimeCode)?.code || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "description")) {
    base.description = sanitizeTextBlock(input.description, 4000);
  }
  if (Object.prototype.hasOwnProperty.call(input, "amenities")) {
    base.amenities = sanitizeTextList(input.amenities, { maxItems: 40, itemMaxLength: 80 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "hiddenAmenities")) {
    base.hiddenAmenities = sanitizeTextList(input.hiddenAmenities, { maxItems: 60, itemMaxLength: 80 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "addedAmenities")) {
    base.addedAmenities = sanitizeTextList(input.addedAmenities, { maxItems: 30, itemMaxLength: 80 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "photoUrls")) {
    base.photoUrls = sanitizeUrlList(input.photoUrls, { maxItems: 12, itemMaxLength: 500 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "addedPhotoUrls")) {
    base.addedPhotoUrls = sanitizeUrlList(input.addedPhotoUrls, { maxItems: 12, itemMaxLength: 500 });
  }
  if (Object.prototype.hasOwnProperty.call(input, "publicContactEmail")) {
    base.publicContactEmail = sanitizeEmail(input.publicContactEmail);
  }
  if (Object.prototype.hasOwnProperty.call(input, "publicContactPhone")) {
    base.publicContactPhone = sanitizeText(input.publicContactPhone, 40);
  }
  if (Object.prototype.hasOwnProperty.call(input, "inquiryEnabled")) {
    base.inquiryEnabled = Boolean(input.inquiryEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, "inquiryEmail")) {
    base.inquiryEmail = sanitizeEmail(input.inquiryEmail);
  }
  if (Object.prototype.hasOwnProperty.call(input, "inquiryPhone")) {
    base.inquiryPhone = sanitizeText(input.inquiryPhone, 40);
  }
  if (Object.prototype.hasOwnProperty.call(input, "inquiryCtaLabel")) {
    base.inquiryCtaLabel = sanitizeText(input.inquiryCtaLabel, 40);
  }
  if (Object.prototype.hasOwnProperty.call(input, "destinationEmailEnabled")) {
    base.destinationEmailEnabled = Boolean(input.destinationEmailEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, "reviewBoostEnabled")) {
    base.reviewBoostEnabled = Boolean(input.reviewBoostEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, "googleReviewUrl")) {
    base.googleReviewUrl = sanitizeUrl(input.googleReviewUrl, 500);
  }
  if (Object.prototype.hasOwnProperty.call(input, "upsellEnabled")) {
    base.upsellEnabled = Boolean(input.upsellEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(input, "upsellTitle")) {
    base.upsellTitle = sanitizeText(input.upsellTitle, 80);
  }
  if (Object.prototype.hasOwnProperty.call(input, "upsellDescription")) {
    base.upsellDescription = sanitizeText(input.upsellDescription, 220);
  }
  if (Object.prototype.hasOwnProperty.call(input, "upsellCtaLabel")) {
    base.upsellCtaLabel = sanitizeText(input.upsellCtaLabel, 40);
  }
  if (Object.prototype.hasOwnProperty.call(input, "upsellUrl")) {
    base.upsellUrl = sanitizeUrl(input.upsellUrl, 500);
  }

  return base;
};

export const resolvePartnerProfileFromClaim = (claim, now = new Date()) => {
  const access = resolvePartnerFeatureAccess(claim, now);
  const overrides =
    claim?.profile_overrides && typeof claim.profile_overrides === "object" && !Array.isArray(claim.profile_overrides)
      ? claim.profile_overrides
      : {};
  const snapshot = resolvePartnerProfileSnapshot(claim);
  const amenityDelta = resolvePartnerAmenityDelta({
    snapshotAmenities: snapshot.amenities,
    overrides,
  });
  const photoDelta = resolvePartnerPhotoDelta({
    snapshotPhotoUrls: snapshot.photoUrls,
    overrides,
  });
  const publicContactEmail =
    sanitizeEmail(overrides.publicContactEmail || snapshot.publicContactEmail || claim?.contact_email);
  const publicContactPhone =
    sanitizeText(overrides.publicContactPhone || snapshot.publicContactPhone || claim?.contact_phone, 40);
  const responseTime = getPartnerResponseTimeOption(overrides.responseTimeCode);
  const contactEmail = sanitizeEmail(overrides.inquiryEmail || publicContactEmail || claim?.contact_email);
  const inquiryCtaLabel = sanitizeText(overrides.inquiryCtaLabel, 40) || PARTNER_INQUIRY_CTA_LABEL;
  const inquiryEnabled =
    access.bookingInquiryVisible &&
    Boolean((overrides.inquiryEnabled ?? true) && contactEmail);
  const destinationEmailEnabled =
    access.destinationEmailsVisible && Boolean(overrides.destinationEmailEnabled ?? true);
  const googleReviewUrl = access.reviewBoostVisible ? sanitizeUrl(overrides.googleReviewUrl, 500) : null;
  const reviewBoostEnabled =
    access.reviewBoostVisible && Boolean((overrides.reviewBoostEnabled ?? false) && googleReviewUrl);
  const upsellUrl = access.upsellVisible ? sanitizeUrl(overrides.upsellUrl, 500) : null;
  const upsellEnabled = access.upsellVisible && Boolean((overrides.upsellEnabled ?? false) && upsellUrl);
  const resolvedCity = sanitizeText(claim?.hotel?.city_name, 150);

  return {
    description: access.basicProfileVisible ? sanitizeTextBlock(overrides.description, 4000) || snapshot.description : null,
    amenities: access.basicProfileVisible
      ? amenityDelta.effectiveAmenities
      : [],
    amenityEditor: access.basicProfileVisible
      ? {
          mode: amenityDelta.mode,
          baseAmenities: amenityDelta.baseAmenities,
          hiddenAmenities: amenityDelta.hiddenAmenities,
          addedAmenities: amenityDelta.addedAmenities,
        }
      : {
          mode: "delta",
          baseAmenities: [],
          hiddenAmenities: [],
          addedAmenities: [],
        },
    photoUrls: access.basicProfileVisible
      ? photoDelta.effectivePhotoUrls
      : [],
    photoEditor: access.basicProfileVisible
      ? {
          basePhotoUrls: photoDelta.basePhotoUrls,
          addedPhotoUrls: photoDelta.addedPhotoUrls,
        }
      : {
          basePhotoUrls: [],
          addedPhotoUrls: [],
        },
    publicContactEmail: access.basicProfileVisible ? publicContactEmail : null,
    publicContactPhone: access.basicProfileVisible ? publicContactPhone : null,
    specialOfferText: access.specialOffersVisible
      ? sanitizeText(overrides.specialOfferText, 140)
      : null,
    responseTimeCode: access.responseTimeVisible ? responseTime?.code || null : null,
    responseTimeLabel: access.responseTimeVisible ? responseTime?.label || null : null,
    responseTimeShortLabel: access.responseTimeVisible ? responseTime?.shortLabel || null : null,
    inquiryEnabled,
    inquiryCtaLabel,
    inquiryEmail: contactEmail,
    inquiryPhone: sanitizeText(overrides.inquiryPhone || publicContactPhone || claim?.contact_phone, 40),
    destinationEmailEnabled,
    destinationEmailEligible: Boolean(destinationEmailEnabled && resolvedCity),
    destinationEmailCity: destinationEmailEnabled ? resolvedCity : null,
    googleReviewUrl,
    reviewBoostEnabled,
    upsellEnabled,
    upsellTitle: access.upsellVisible ? sanitizeText(overrides.upsellTitle, 80) || "Exclusive hotel offer" : null,
    upsellDescription: access.upsellVisible ? sanitizeText(overrides.upsellDescription, 220) : null,
    upsellCtaLabel: access.upsellVisible ? sanitizeText(overrides.upsellCtaLabel, 40) || "Unlock offer" : null,
    upsellUrl,
    features: access,
  };
};

export const buildPublicPartnerProfile = (claim, now = new Date()) => {
  const resolved = resolvePartnerProfileFromClaim(claim, now);
  return {
    description: resolved.description || null,
    amenities: Array.isArray(resolved.amenities) ? resolved.amenities : [],
    photoUrls: Array.isArray(resolved.photoUrls) ? resolved.photoUrls : [],
    publicContactEmail: resolved.publicContactEmail || null,
    publicContactPhone: resolved.publicContactPhone || null,
    amenityEditor: resolved.amenityEditor || {
      mode: "delta",
      baseAmenities: [],
      hiddenAmenities: [],
      addedAmenities: [],
    },
    photoEditor: resolved.photoEditor || {
      basePhotoUrls: [],
      addedPhotoUrls: [],
    },
    specialOfferText: resolved.specialOfferText,
    responseTimeLabel: resolved.responseTimeLabel,
    responseTimeShortLabel: resolved.responseTimeShortLabel,
    inquiryEnabled: Boolean(resolved.inquiryEnabled),
    inquiryCtaLabel: resolved.inquiryCtaLabel,
    destinationEmailEnabled: Boolean(resolved.destinationEmailEnabled),
    destinationEmailCity: resolved.destinationEmailCity || null,
    upsellEnabled: Boolean(resolved.upsellEnabled),
    upsellTitle: resolved.upsellTitle || null,
    upsellDescription: resolved.upsellDescription || null,
    upsellCtaLabel: resolved.upsellCtaLabel || null,
    upsellUrl: resolved.upsellUrl || null,
  };
};

const normalizeDate = (value) => {
  const date = dayjs(value);
  return date.isValid() ? date : null;
};

export const getPartnerClaimAgeDays = (claim, now = new Date()) => {
  const startedAt = normalizeDate(claim?.trial_started_at || claim?.claimed_at);
  if (!startedAt) return null;
  return dayjs(now).startOf("day").diff(startedAt.startOf("day"), "day") + 1;
};

export const resolvePartnerProgramFromClaim = (claim, now = new Date()) => {
  if (!claim) return null;
  const ageDays = getPartnerClaimAgeDays(claim, now);
  const trialEndsAt = normalizeDate(claim?.trial_ends_at);
  const hasActiveSubscription =
    String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.subscribed ||
    [PARTNER_SUBSCRIPTION_STATUSES.active, PARTNER_SUBSCRIPTION_STATUSES.trialing].includes(
      String(claim?.subscription_status || "").toLowerCase(),
    );
  const pendingInvoice =
    String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.invoicePending;

  const currentPlan = getPartnerPlanByCode(claim?.current_plan_code);
  const pendingPlan = getPartnerPlanByCode(claim?.pending_plan_code);
  const trialIsActive = Boolean(
    !hasActiveSubscription &&
      trialEndsAt &&
      dayjs(now).isBefore(trialEndsAt.add(1, "second")),
  );

  let badge = null;
  let plan = currentPlan;
  let statusLabel = "No badge";
  const cancellationMeta =
    claim?.meta && typeof claim.meta === "object" ? claim.meta.subscriptionCancellation || null : null;
  const cancelScheduled = Boolean(cancellationMeta?.cancelAtPeriodEnd);
  const cancelEffectiveAt = cancellationMeta?.effectiveAt || null;

  if (trialIsActive) {
    badge = getPartnerBadgeByCode("featured");
    plan = getPartnerPlanByCode("featured");
    statusLabel = "Trial active";
  } else if (hasActiveSubscription && currentPlan) {
    badge = getPartnerBadgeByCode(currentPlan.badgeCode);
    statusLabel = cancelScheduled ? "Cancellation scheduled" : "Subscribed";
  } else if (pendingInvoice && pendingPlan) {
    badge = null;
    plan = pendingPlan;
    statusLabel = "Invoice pending";
  } else if (String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.cancelled) {
    badge = null;
    statusLabel = "Cancelled";
  } else if (String(claim?.claim_status || "").toUpperCase() === PARTNER_CLAIM_STATUSES.expired) {
    badge = null;
    statusLabel = "Badge removed";
  }

  const trialDaysLeft =
    trialEndsAt && trialIsActive
      ? Math.max(0, trialEndsAt.endOf("day").diff(dayjs(now), "day"))
      : 0;

  return {
    claimId: claim.id,
    hotelId: claim.hotel_id != null ? String(claim.hotel_id) : null,
    claimStatus: claim.claim_status || null,
    subscriptionStatus: claim.subscription_status || null,
    statusLabel,
    badgeCode: badge?.code || null,
    badgeLabel: badge?.label || null,
    badgeColorHex: badge?.hex || null,
    badgePriority: badge?.priority || 0,
    planCode: plan?.code || null,
    planLabel: plan?.label || null,
    priceMonthly: plan?.priceMonthly ?? null,
    currency: plan?.currency || "USD",
    trialActive: trialIsActive,
    trialStartedAt: claim.trial_started_at || claim.claimed_at || null,
    trialEndsAt: claim.trial_ends_at || null,
    trialDaysLeft,
    ageDays,
    priceVisible: Boolean(ageDays != null && ageDays >= PARTNER_PRICE_DISCLOSURE_DAY),
    nextBillingAt: claim.next_billing_at || null,
    invoiceRequestedAt: claim.invoice_requested_at || null,
    invoicePaidAt: claim.invoice_paid_at || null,
    billingMethod: claim.billing_method || null,
    pendingPlanCode: pendingPlan?.code || null,
    pendingPlanLabel: pendingPlan?.label || null,
    cancelScheduled,
    cancelEffectiveAt,
  };
};

export const resolvePartnerBadgePriority = (item) => {
  const direct = Number(item?.partnerProgram?.badgePriority);
  if (Number.isFinite(direct)) return direct;
  const nested = Number(item?.hotelDetails?.partnerProgram?.badgePriority);
  if (Number.isFinite(nested)) return nested;
  const badgeKey =
    item?.partnerProgram?.badgeCode ||
    item?.hotelDetails?.partnerProgram?.badgeCode ||
    String(item?.badge || "").trim().toLowerCase();
  return getPartnerBadgeByCode(badgeKey)?.priority || 0;
};
