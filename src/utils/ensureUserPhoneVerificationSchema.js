import { DataTypes, QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";

const TABLE = "user";
const PHONE_COLUMN = "phone";
const PHONE_E164_COLUMN = "phone_e164";
const PHONE_VERIFIED_COLUMN = "phone_verified";
const PHONE_VERIFIED_AT_COLUMN = "phone_verified_at";
const PHONE_E164_INDEX = "uq_user_phone_e164";
const DEBUG = process.env.DEBUG_USER_PHONE_SCHEMA === "1";

const logDebug = (...args) => {
  if (DEBUG) console.log("[ensureUserPhoneVerificationSchema]", ...args);
};

const queryInterface = sequelize.getQueryInterface();
const quoteTable = (table) => queryInterface.queryGenerator.quoteTable(table);
const quoteIdentifier = (identifier) => queryInterface.queryGenerator.quoteIdentifier(identifier);

const describeTable = async () =>
  queryInterface.describeTable(TABLE).catch(() => null);

const normalizePhoneE164 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s\-()]/g, "");
  if (!compact.startsWith("+")) return null;
  const normalized = `+${compact.slice(1).replace(/\D/g, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
};

const addColumnIfMissing = async (description, column, definition) => {
  if (description?.[column]) return description;
  await queryInterface.addColumn(TABLE, column, definition);
  logDebug("Added missing column", column);
  return describeTable();
};

const getIndexes = async () => {
  try {
    return await queryInterface.showIndex(TABLE);
  } catch {
    return [];
  }
};

const addUniqueIndexIfMissing = async () => {
  const indexes = await getIndexes();
  if (indexes.some((index) => index?.name === PHONE_E164_INDEX)) return;
  await queryInterface.addIndex(TABLE, [PHONE_E164_COLUMN], {
    name: PHONE_E164_INDEX,
    unique: true,
  });
  logDebug("Added unique index", PHONE_E164_INDEX);
};

const backfillCanonicalPhones = async () => {
  const qTable = quoteTable(TABLE);
  const qId = quoteIdentifier("id");
  const qPhone = quoteIdentifier(PHONE_COLUMN);
  const qPhoneE164 = quoteIdentifier(PHONE_E164_COLUMN);

  const rows = await sequelize.query(
    `SELECT ${qId} AS id, ${qPhone} AS phone, ${qPhoneE164} AS phone_e164 FROM ${qTable} ORDER BY ${qId} ASC`,
    { type: QueryTypes.SELECT },
  );

  const keeperByPhone = new Map();
  const duplicatePhones = new Set();

  for (const row of rows) {
    const normalized = normalizePhoneE164(row?.phone_e164 ?? row?.phone);
    if (!normalized) continue;
    if (keeperByPhone.has(normalized)) {
      duplicatePhones.add(normalized);
      continue;
    }
    keeperByPhone.set(normalized, Number(row.id));
  }

  for (const row of rows) {
    const id = Number(row?.id);
    const normalizedFromPhone = normalizePhoneE164(row?.phone);
    if (!id || !normalizedFromPhone || duplicatePhones.has(normalizedFromPhone)) continue;
    await queryInterface.bulkUpdate(
      TABLE,
      { [PHONE_E164_COLUMN]: normalizedFromPhone },
      { id, [PHONE_E164_COLUMN]: null },
    );
  }
};

const clearDuplicateCanonicalPhones = async () => {
  const qTable = quoteTable(TABLE);
  const qId = quoteIdentifier("id");
  const qPhoneE164 = quoteIdentifier(PHONE_E164_COLUMN);

  const rows = await sequelize.query(
    `SELECT ${qId} AS id, ${qPhoneE164} AS phone_e164 FROM ${qTable} WHERE ${qPhoneE164} IS NOT NULL ORDER BY ${qId} ASC`,
    { type: QueryTypes.SELECT },
  );

  const keeperByPhone = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    const canonicalPhone = normalizePhoneE164(row?.phone_e164);
    if (!id || !canonicalPhone) continue;
    if (!keeperByPhone.has(canonicalPhone)) {
      keeperByPhone.set(canonicalPhone, id);
      continue;
    }

    await queryInterface.bulkUpdate(
      TABLE,
      {
        [PHONE_E164_COLUMN]: null,
        [PHONE_VERIFIED_COLUMN]: false,
        [PHONE_VERIFIED_AT_COLUMN]: null,
      },
      { id },
    );
    logDebug("Cleared duplicate canonical phone", canonicalPhone, "from user", id);
  }
};

const ensureUserPhoneVerificationSchema = async () => {
  let description = await describeTable();
  if (!description) return;

  description = await addColumnIfMissing(description, PHONE_E164_COLUMN, {
    type: DataTypes.STRING(20),
    allowNull: true,
  });
  description = await addColumnIfMissing(description, PHONE_VERIFIED_COLUMN, {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
  description = await addColumnIfMissing(description, PHONE_VERIFIED_AT_COLUMN, {
    type: DataTypes.DATE,
    allowNull: true,
  });

  await backfillCanonicalPhones();
  await clearDuplicateCanonicalPhones();
  await addUniqueIndexIfMissing();
};

export default ensureUserPhoneVerificationSchema;
