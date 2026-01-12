// src/services/badge.service.js
import { Op } from "sequelize";
import models, { sequelize } from "../models/index.js";
import { DEFAULT_BADGES } from "../data/badges/defaultBadges.js";

const ASSIGNMENT_ACTIVE_STATES = ["ACTIVE", "PENDING"];

let catalogEnsured = false;

const sanitized = (badge, extra = {}) => ({
  slug: badge.slug,
  scope: badge.scope,
  title: badge.title,
  subtitle: badge.subtitle,
  description: badge.description,
  icon: badge.icon,
  priority: badge.priority ?? 0,
  criteria: badge.criteria ?? {},
  ...extra,
});

export const ensureBadgeCatalog = async () => {
  if (catalogEnsured) return;
  const transaction = await sequelize.transaction();
  try {
    for (const definition of DEFAULT_BADGES) {
      const [record, created] = await models.Badge.findOrCreate({
        where: { slug: definition.slug },
        defaults: definition,
        transaction,
      });
      if (!created) {
        await record.update(
          {
            scope: definition.scope,
            title: definition.title,
            subtitle: definition.subtitle,
            description: definition.description,
            icon: definition.icon,
            criteria: definition.criteria,
            priority: definition.priority ?? record.priority ?? 0,
            active: true,
          },
          { transaction },
        );
      }
    }
    await transaction.commit();
    catalogEnsured = true;
  } catch (err) {
    await transaction.rollback();
    console.error("[badge.service] ensureBadgeCatalog failed:", err);
    throw err;
  }
};

const resultMapFromAssignments = (assignments = []) => {
  const map = new Map();
  assignments.forEach((assignment) => {
    const badge = assignment.badge;
    if (!badge) return;
    if (!ASSIGNMENT_ACTIVE_STATES.includes(assignment.status)) return;
    map.set(badge.slug, sanitized(badge, {
      status: assignment.status,
      awardedAt: assignment.awarded_at,
      expiresAt: assignment.expires_at,
      source: "assignment",
      metadata: assignment.metadata ?? {},
      score: assignment.score != null ? Number(assignment.score) : null,
    }));
  });
  return map;
};

const normalizeCancellationPolicy = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("flex")) return "FLEXIBLE";
  if (normalized.includes("free")) return "FLEXIBLE";
  if (normalized.includes("moder")) return "MODERATE";
  if (normalized.includes("firm") || normalized.includes("firme")) return "FIRM";
  if (normalized.includes("strict") || normalized.includes("estrict")) return "STRICT";
  if (normalized.includes("non") || normalized.includes("no reembolsable")) return "NON_REFUNDABLE";
  return normalized.toUpperCase();
};

const evaluateDerivedHomeBadges = (home) => {
  if (!home) return [];
  const bag = [];
  const marketingTags = Array.isArray(home.marketing_tags) ? home.marketing_tags.map(String) : [];
  const stats = home.meta?.stats || {};

  const rating = Number(home.rating ?? stats.overallRating ?? home.avg_rating ?? 0);
  const reviewCount = Number(home.review_count ?? stats.reviews ?? 0);

  if (marketingTags.includes("TOP_RATED") || (rating >= 4.8 && reviewCount >= 20)) {
    bag.push("home_top_rated_10");
  }

  const checkInScore = Number(stats.checkinScore ?? stats.arrivalRating ?? home.arrival_rating ?? 0);
  if (checkInScore >= 4.9 && reviewCount >= 5) {
    bag.push("home_exceptional_checkin");
  }

  const cancellationPolicyRaw =
    home.policies?.cancellation_policy ??
    home.policies?.cancellation ??
    home.policies?.cancellationPolicy ??
    home.house_rules_snapshot?.cancellation_policy ??
    null;
  const cancellationPolicy = normalizeCancellationPolicy(cancellationPolicyRaw);
  if (cancellationPolicy === "FLEXIBLE") {
    bag.push("home_free_cancellation");
  }

  if (home.space_type === "PRIVATE_ROOM") {
    bag.push("home_private_room");
  } else if (home.space_type === "ENTIRE_PLACE") {
    bag.push("home_entire_place");
  }

  return bag;
};

const evaluateDerivedHostBadges = (host) => {
  if (!host) return [];
  const meta = host.hostProfile?.metadata ?? host.metadata ?? {};
  const kycStatus =
    host.hostProfile?.kyc_status ??
    meta.kyc_status ??
    meta.kycStatus ??
    null;
  const identityVerified =
    meta.identity_verified ??
    meta.identityVerified ??
    host.email_verified ??
    false;
  const isVerified =
    String(kycStatus || "").toUpperCase() === "APPROVED" || Boolean(identityVerified);
  const bag = [];
  if (isVerified) {
    bag.push("host_verified");
  }
  const isSuperhost = Boolean(meta.is_superhost ?? meta.superhost ?? host.superhost);
  if (isSuperhost) return [...bag, "host_superhost"];
  const rating = Number(meta.overall_rating ?? host.avg_rating ?? 0);
  const stays = Number(meta.completed_stays ?? 0);
  if (rating >= 4.8 && stays >= 10) {
    return [...bag, "host_superhost"];
  }
  return bag;
};

const mergeDerivedBadges = (map, derivedSlugs = []) => {
  for (const slug of derivedSlugs) {
    if (map.has(slug)) continue;
    const badge = DEFAULT_BADGES.find((item) => item.slug === slug);
    if (!badge) continue;
    map.set(slug, sanitized(badge, {
      status: "ACTIVE",
      source: "derived",
    }));
  }
  return map;
};

const sortedBadges = (map) =>
  Array.from(map.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));

export const getHomeBadges = async (home, { includeDerived = true } = {}) => {
  await ensureBadgeCatalog();

  const homeId = home?.id;
  if (!homeId) return [];

  const assignments = await models.HomeBadge.findAll({
    where: {
      home_id: homeId,
      status: { [Op.ne]: "REVOKED" },
    },
    include: [{ model: models.Badge, as: "badge", required: false, where: { active: true } }],
    order: [[{ model: models.Badge, as: "badge" }, "priority", "DESC"]],
  });

  const map = resultMapFromAssignments(assignments);
  if (includeDerived) {
    mergeDerivedBadges(map, evaluateDerivedHomeBadges(home));
  }
  return sortedBadges(map);
};

export const getHostBadges = async (host, { includeDerived = true } = {}) => {
  await ensureBadgeCatalog();
  const userId = host?.id;
  if (!userId) return [];

  const assignments = await models.HostBadge.findAll({
    where: {
      user_id: userId,
      status: { [Op.ne]: "REVOKED" },
    },
    include: [{ model: models.Badge, as: "badge", required: false, where: { active: true } }],
    order: [[{ model: models.Badge, as: "badge" }, "priority", "DESC"]],
  });

  const map = resultMapFromAssignments(assignments);
  if (includeDerived) {
    mergeDerivedBadges(map, evaluateDerivedHostBadges(host));
  }
  return sortedBadges(map);
};

