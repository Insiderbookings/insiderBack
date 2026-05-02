// Migration: add canonical phone verification fields to user

const TABLE = "user";
const PHONE_E164_COLUMN = "phone_e164";
const PHONE_VERIFIED_COLUMN = "phone_verified";
const PHONE_VERIFIED_AT_COLUMN = "phone_verified_at";
const PHONE_E164_INDEX = "uq_user_phone_e164";

const normalizePhoneE164 = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const compact = raw.replace(/[\s\-()]/g, "");
  if (!compact.startsWith("+")) return null;
  const normalized = `+${compact.slice(1).replace(/\D/g, "")}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
};

const hasColumn = async (queryInterface, table, column) => {
  try {
    const desc = await queryInterface.describeTable(table);
    return Object.prototype.hasOwnProperty.call(desc, column);
  } catch {
    return false;
  }
};

const addIndexIfMissing = async (queryInterface, table, fields, options) => {
  try {
    await queryInterface.addIndex(table, fields, options);
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (
      message.includes("already exists") ||
      message.includes("duplicate key name") ||
      (message.includes("relation") && message.includes("already exists"))
    ) {
      return;
    }
    throw error;
  }
};

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize;
  const tableName = queryInterface.queryGenerator.quoteTable(TABLE);
  const idColumn = queryInterface.queryGenerator.quoteIdentifier("id");
  const phoneColumn = queryInterface.queryGenerator.quoteIdentifier("phone");

  if (!(await hasColumn(queryInterface, TABLE, PHONE_E164_COLUMN))) {
    await queryInterface.addColumn(TABLE, PHONE_E164_COLUMN, {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  }

  if (!(await hasColumn(queryInterface, TABLE, PHONE_VERIFIED_COLUMN))) {
    await queryInterface.addColumn(TABLE, PHONE_VERIFIED_COLUMN, {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  }

  if (!(await hasColumn(queryInterface, TABLE, PHONE_VERIFIED_AT_COLUMN))) {
    await queryInterface.addColumn(TABLE, PHONE_VERIFIED_AT_COLUMN, {
      type: Sequelize.DATE,
      allowNull: true,
    });
  }

  const rows = await queryInterface.sequelize.query(
    `SELECT ${idColumn} AS id, ${phoneColumn} AS phone FROM ${tableName}`,
    { type: Sequelize.QueryTypes.SELECT }
  );

  const candidateIdsByPhone = new Map();
  const duplicatePhones = new Set();

  for (const row of rows) {
    const normalized = normalizePhoneE164(row?.phone);
    if (!normalized) continue;
    if (candidateIdsByPhone.has(normalized)) {
      duplicatePhones.add(normalized);
      continue;
    }
    candidateIdsByPhone.set(normalized, Number(row.id));
  }

  for (const row of rows) {
    const id = Number(row?.id);
    const normalized = normalizePhoneE164(row?.phone);
    if (!id || !normalized || duplicatePhones.has(normalized)) continue;
    await queryInterface.bulkUpdate(
      TABLE,
      { [PHONE_E164_COLUMN]: normalized },
      { id }
    );
  }

  await addIndexIfMissing(queryInterface, TABLE, [PHONE_E164_COLUMN], {
    name: PHONE_E164_INDEX,
    unique: true,
  });
}

async function down(queryInterface) {
  try {
    await queryInterface.removeIndex(TABLE, PHONE_E164_INDEX);
  } catch (_) {
    // ignore
  }

  const dropColumn = async (column) => {
    try {
      await queryInterface.removeColumn(TABLE, column);
    } catch (_) {
      // ignore
    }
  };

  await dropColumn(PHONE_VERIFIED_AT_COLUMN);
  await dropColumn(PHONE_VERIFIED_COLUMN);
  await dropColumn(PHONE_E164_COLUMN);
}

module.exports = { up, down };
