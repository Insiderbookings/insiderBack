import models from "../models/index.js";
import { PLATFORM_DEFAULTS, PLATFORM_STATUS } from "../constants/platforms.js";

export async function ensureDefaultPlatforms() {
  for (const def of PLATFORM_DEFAULTS) {
    const payload = {
      name: def.name,
      slug: def.slug,
      requiresFaceVerification: Boolean(def.requiresFaceVerification),
      description: def.description || null,
    };
    await models.Platform.findOrCreate({
      where: { slug: payload.slug },
      defaults: payload,
    });
  }
}

export async function getTenantPlatformSnapshot(tenantId) {
  const platforms = await models.Platform.findAll({
    order: [["requiresFaceVerification", "DESC"], ["name", "ASC"]],
  });
  const links = await models.WcTenantPlatform.findAll({
    where: { tenant_id: tenantId },
  });
  const linkMap = new Map(
    links.map((l) => {
      const data = typeof l.toJSON === "function" ? l.toJSON() : l;
      return [data.platform_id, data];
    })
  );
  return platforms.map((p) => {
    const link = linkMap.get(p.id);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      requiresFaceVerification: Boolean(p.requiresFaceVerification),
      description: p.description || "",
      status: link?.status || PLATFORM_STATUS[0],
      username: link?.username || "",
      password: link?.password || "",
      faceVerificationUrl: link?.face_verification_url || "",
      updatedAt: link?.updated_at || link?.created_at || p.updated_at || null,
      createdAt: link?.created_at || p.created_at || null,
    };
  });
}

export { PLATFORM_DEFAULTS, PLATFORM_STATUS };
