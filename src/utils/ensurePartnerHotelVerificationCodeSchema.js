import { DataTypes, QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

const TABLE = "partner_hotel_verification_code";

const LEGACY_COLUMN_RENAMES = [
  ["verification_code", "code"],
  ["generated_by_user_id", "created_by_user_id"],
  ["used_by_user_id", "claimed_by_user_id"],
  ["used_at", "claimed_at"],
];

const LEGACY_INDEXES = [
  "uq_partner_hotel_verification_code_value",
  "idx_partner_hotel_verification_code_generated_by_user",
  "idx_partner_hotel_verification_code_used_by_user",
];

const DEBUG = process.env.DEBUG_PARTNER_VERIFICATION_SCHEMA === "1";

const logDebug = (...args) => {
  if (DEBUG) console.log("[ensurePartnerHotelVerificationCodeSchema]", ...args);
};

const quoteIdentifier = (identifier) => sequelize.getQueryInterface().quoteIdentifier(identifier);

const describeTable = async () =>
  sequelize
    .getQueryInterface()
    .describeTable(TABLE)
    .catch(() => null);

const dropIndexIfExists = async (name) => {
  try {
    await sequelize.getQueryInterface().removeIndex(TABLE, name);
    logDebug("Dropped legacy index", name);
  } catch (error) {
    logDebug("Skipping legacy index", name, error?.message);
  }
};

const copyColumnValues = async ({ from, to }) => {
  const qTable = quoteIdentifier(TABLE);
  const qFrom = quoteIdentifier(from);
  const qTo = quoteIdentifier(to);
  await sequelize.query(
    `UPDATE ${qTable} SET ${qTo} = ${qFrom} WHERE ${qTo} IS NULL AND ${qFrom} IS NOT NULL`,
    { type: QueryTypes.UPDATE },
  );
};

const addColumnIfMissing = async (description, column, definition) => {
  if (description?.[column]) return description;
  await sequelize.getQueryInterface().addColumn(TABLE, column, definition);
  logDebug("Added missing column", column);
  return describeTable();
};

const ensurePartnerHotelVerificationCodeSchema = async () => {
  let description = await describeTable();
  if (!description) return;

  for (const indexName of LEGACY_INDEXES) {
    await dropIndexIfExists(indexName);
  }

  for (const [legacyColumn, targetColumn] of LEGACY_COLUMN_RENAMES) {
    description = await describeTable();
    const hasLegacy = Boolean(description?.[legacyColumn]);
    const hasTarget = Boolean(description?.[targetColumn]);
    if (hasLegacy && !hasTarget) {
      await sequelize.getQueryInterface().renameColumn(TABLE, legacyColumn, targetColumn);
      logDebug("Renamed column", legacyColumn, "to", targetColumn);
    } else if (hasLegacy && hasTarget) {
      await copyColumnValues({ from: legacyColumn, to: targetColumn });
      logDebug("Copied values from legacy column", legacyColumn, "to", targetColumn);
    }
  }

  description = await describeTable();
  description = await addColumnIfMissing(description, "code", {
    type: DataTypes.STRING(8),
    allowNull: true,
  });
  description = await addColumnIfMissing(description, "created_by_user_id", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  description = await addColumnIfMissing(description, "claimed_by_user_id", {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
  description = await addColumnIfMissing(description, "claimed_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addColumnIfMissing(description, "deleted_at", {
    type: DataTypes.DATE,
    allowNull: true,
  });
};

export default ensurePartnerHotelVerificationCodeSchema;
