import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

const HOME_FAVORITE_TABLE = "home_favorite";
const TARGET_INDEX = "home_favorite_user_home_list_unique";

const LEGACY_CONSTRAINTS = [
  "home_favorite_user_id_home_id_key",
  "home_favorite_user_home_unique",
  "home_favorite_user_id_home_id_unique",
  "home_favorite_user_id_home_id_list_id_key",
  "home_favorite_user_id_home_id_idx",
];

const DEBUG = process.env.DEBUG_HOME_FAVORITE_INDEX === "1";

const logDebug = (...args) => {
  if (DEBUG) console.log("[ensureHomeFavoriteIndexes]", ...args);
};

const dropConstraintIfExists = async (name) => {
  try {
    await sequelize.query(
      `ALTER TABLE ${HOME_FAVORITE_TABLE} DROP CONSTRAINT IF EXISTS "${name}"`,
      { type: QueryTypes.RAW }
    );
    logDebug("Dropped constraint", name);
  } catch (err) {
    logDebug("Failed to drop constraint", name, err?.message);
  }
};

const dropIndexIfExists = async (name) => {
  try {
    await sequelize.query(`DROP INDEX IF EXISTS "${name}"`, { type: QueryTypes.RAW });
    logDebug("Dropped index", name);
  } catch (err) {
    logDebug("Failed to drop index", name, err?.message);
  }
};

const dropLegacyArtifacts = async () => {
  for (const legacy of LEGACY_CONSTRAINTS) {
    await dropConstraintIfExists(legacy);
    await dropIndexIfExists(legacy);
  }

  // remove any unique index that only references user_id/home_id
  const indexes = await sequelize.query(
    `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = :table
    `,
    {
      replacements: { table: HOME_FAVORITE_TABLE },
      type: QueryTypes.SELECT,
    }
  );

  for (const idx of Array.isArray(indexes) ? indexes : []) {
    if (!idx?.indexdef) continue;
    const def = String(idx.indexdef).toLowerCase();
    if (def.includes("unique") && def.includes("(user_id, home_id)") && !def.includes("list_id")) {
      await dropIndexIfExists(idx.indexname);
    }
  }
};

const ensureTargetIndex = async () => {
  await sequelize.query(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS "${TARGET_INDEX}"
      ON ${HOME_FAVORITE_TABLE} (user_id, home_id, list_id)
      WHERE deleted_at IS NULL
    `,
    { type: QueryTypes.RAW }
  );
  logDebug("Ensured target index", TARGET_INDEX);
};

const ensureHomeFavoriteIndexes = async () => {
  await dropLegacyArtifacts();
  await ensureTargetIndex();
};

export default ensureHomeFavoriteIndexes;
