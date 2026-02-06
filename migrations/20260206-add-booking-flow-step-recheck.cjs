// Migration: add RECHECK step to booking_flow_steps enum

async function up(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === "postgres") {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
          WHERE t.typname = 'enum_booking_flow_steps_step'
            AND e.enumlabel = 'RECHECK'
        ) THEN
          ALTER TYPE "enum_booking_flow_steps_step" ADD VALUE 'RECHECK';
        END IF;
      END
      $$;
    `);
  } else {
    await queryInterface.sequelize.query(`
      ALTER TABLE booking_flow_steps
      MODIFY COLUMN step ENUM(
        'GETROOMS',
        'BLOCK',
        'SAVEBOOKING',
        'BOOK_NO',
        'PREAUTH',
        'BOOK_YES',
        'CANCEL_NO',
        'CANCEL_YES',
        'RECHECK'
      ) NOT NULL;
    `);
  }
}

async function down(queryInterface) {
  const dialect = queryInterface.sequelize.getDialect();
  if (dialect === "postgres") {
    // Postgres does not support removing enum values safely; keep as-is.
    return;
  }
  await queryInterface.sequelize.query(`
    ALTER TABLE booking_flow_steps
    MODIFY COLUMN step ENUM(
      'GETROOMS',
      'BLOCK',
      'SAVEBOOKING',
      'BOOK_NO',
      'PREAUTH',
      'BOOK_YES',
      'CANCEL_NO',
      'CANCEL_YES'
    ) NOT NULL;
  `);
}

module.exports = { up, down };
