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
const DIALECT = sequelize.getDialect(); // 'postgres', 'mysql', 'mariadb', etc.

const logDebug = (...args) => {
  if (DEBUG) console.log("[ensureHomeFavoriteIndexes]", ...args);
};

const dropConstraintIfExists = async (name) => {
  // Solo Postgres tiene DROP CONSTRAINT así
  if (DIALECT !== "postgres") {
    logDebug("Skipping constraint drop on dialect", DIALECT, "for", name);
    return;
  }

  try {
    await sequelize.query(
      `ALTER TABLE "${HOME_FAVORITE_TABLE}" DROP CONSTRAINT IF EXISTS "${name}"`,
      { type: QueryTypes.RAW }
    );
    logDebug("Dropped constraint", name);
  } catch (err) {
    logDebug("Failed to drop constraint", name, err?.message);
  }
};

const dropIndexIfExists = async (name) => {
  try {
    if (DIALECT === "postgres") {
      // índice global en Postgres
      await sequelize.query(`DROP INDEX IF EXISTS "${name}"`, {
        type: QueryTypes.RAW,
      });
    } else if (DIALECT === "mysql" || DIALECT === "mariadb") {
      // En MySQL/MariaDB el índice se borra por tabla
      // No todos los motores soportan IF EXISTS, así que se maneja por try/catch
      await sequelize.query(
        `DROP INDEX \`${name}\` ON \`${HOME_FAVORITE_TABLE}\``,
        { type: QueryTypes.RAW }
      );
    } else {
      logDebug("dropIndexIfExists: dialect no soportado", DIALECT);
      return;
    }

    logDebug("Dropped index", name);
  } catch (err) {
    logDebug("Failed to drop index", name, err?.message);
  }
};

const dropLegacyArtifacts = async () => {
  // Primero intentamos limpiar los nombres legacy que puedan existir
  for (const legacy of LEGACY_CONSTRAINTS) {
    await dropConstraintIfExists(legacy);
    await dropIndexIfExists(legacy);
  }

  // Luego, eliminar cualquier índice ÚNICO que sólo referencie (user_id, home_id)
  // sin incluir list_id

  if (DIALECT === "postgres") {
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
      if (
        def.includes("unique") &&
        def.includes("(user_id, home_id)") &&
        !def.includes("list_id")
      ) {
        await dropIndexIfExists(idx.indexname);
      }
    }
  } else if (DIALECT === "mysql" || DIALECT === "mariadb") {
    const rows = await sequelize.query(
      `SHOW INDEX FROM \`${HOME_FAVORITE_TABLE}\``,
      { type: QueryTypes.SELECT }
    );

    // rows: una fila por columna de cada índice
    const indexMap = new Map();

    for (const row of rows) {
      const name = row.Key_name;
      if (!indexMap.has(name)) {
        indexMap.set(name, {
          name,
          // Non_unique = 0 -> UNIQUE
          nonUnique: row.Non_unique === 1,
          columns: [],
        });
      }
      indexMap.get(name).columns[row.Seq_in_index - 1] = row.Column_name;
    }

    for (const idx of indexMap.values()) {
      // Saltamos la PRIMARY key
      if (idx.name === "PRIMARY") continue;

      const columns = idx.columns.filter(Boolean);
      const isUnique = !idx.nonUnique;

      const colSet = new Set(columns);

      const isUserHomeOnly =
        isUnique &&
        columns.length === 2 &&
        colSet.has("user_id") &&
        colSet.has("home_id") &&
        !colSet.has("list_id");

      if (isUserHomeOnly) {
        await dropIndexIfExists(idx.name);
      }
    }
  } else {
    logDebug("dropLegacyArtifacts: dialect no soportado", DIALECT);
  }
};

const ensureTargetIndex = async () => {
  if (DIALECT === "postgres") {
    // Índice parcial en Postgres
    await sequelize.query(
      `
        CREATE UNIQUE INDEX IF NOT EXISTS "${TARGET_INDEX}"
        ON "${HOME_FAVORITE_TABLE}" (user_id, home_id, list_id)
        WHERE deleted_at IS NULL
      `,
      { type: QueryTypes.RAW }
    );
  } else if (DIALECT === "mysql" || DIALECT === "mariadb") {
    // MySQL/MariaDB NO soportan índices parciales con WHERE.
    // Acá creamos un índice único simple en (user_id, home_id, list_id).
    // OJO: esto NO permite tener duplicados aunque estén "soft deleted".
    const existing = await sequelize.query(
      `
        SHOW INDEX FROM \`${HOME_FAVORITE_TABLE}\`
        WHERE Key_name = :idxName
      `,
      {
        replacements: { idxName: TARGET_INDEX },
        type: QueryTypes.SELECT,
      }
    );

    if (!Array.isArray(existing) || existing.length === 0) {
      await sequelize.query(
        `
          CREATE UNIQUE INDEX \`${TARGET_INDEX}\`
          ON \`${HOME_FAVORITE_TABLE}\` (user_id, home_id, list_id)
        `,
        { type: QueryTypes.RAW }
      );
    }
  } else {
    logDebug("ensureTargetIndex: dialect no soportado", DIALECT);
  }

  logDebug("Ensured target index", TARGET_INDEX);
};

const ensureHomeFavoriteIndexes = async () => {
  await dropLegacyArtifacts();
  await ensureTargetIndex();
};

export default ensureHomeFavoriteIndexes;