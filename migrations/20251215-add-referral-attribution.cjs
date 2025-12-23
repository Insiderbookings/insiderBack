// Migration: add referral attribution columns for influencer tracking

async function up(queryInterface) {
  const { Sequelize } = queryInterface.sequelize

  const hasColumn = async (table, column) => {
    try {
      const desc = await queryInterface.describeTable(table)
      return Object.prototype.hasOwnProperty.call(desc, column)
    } catch {
      return false
    }
  }

  const getIndexNames = async (table) => {
    try {
      const [rows] = await queryInterface.sequelize.query(
        `SHOW INDEX FROM \`${table}\``
      )
      return new Set(rows.map((row) => row.Key_name))
    } catch {
      return new Set()
    }
  }

  const canAddIndex = async (table, name) => {
    const indexNames = await getIndexNames(table)
    if (indexNames.has(name)) {
      return false
    }
    return indexNames.size < 64
  }

  // user.referred_by_influencer_id / referred_by_code / referred_at
  if (!(await hasColumn("user", "referred_by_influencer_id"))) {
    const canAddUserFk = await canAddIndex("user", "fk_user_referred_by_user")
    await queryInterface.addColumn("user", "referred_by_influencer_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      ...(canAddUserFk
        ? {
            references: { model: "user", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
          }
        : {}),
    })
  }
  if (!(await hasColumn("user", "referred_by_code"))) {
    await queryInterface.addColumn("user", "referred_by_code", {
      type: Sequelize.STRING(32),
      allowNull: true,
    })
  }
  if (!(await hasColumn("user", "referred_at"))) {
    await queryInterface.addColumn("user", "referred_at", {
      type: Sequelize.DATE,
      allowNull: true,
    })
  }
  if (await canAddIndex("user", "idx_user_referred_by_influencer")) {
    try {
      await queryInterface.addIndex("user", ["referred_by_influencer_id"], {
        name: "idx_user_referred_by_influencer",
      })
    } catch (_) {
      /* ignore */
    }
  }

  // booking.influencer_user_id (freeze attribution at booking time)
  if (!(await hasColumn("booking", "influencer_user_id"))) {
    const canAddBookingFk = await canAddIndex(
      "booking",
      "fk_booking_influencer_user"
    )
    await queryInterface.addColumn("booking", "influencer_user_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      ...(canAddBookingFk
        ? {
            references: { model: "user", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
          }
        : {}),
    })
  }
  if (await canAddIndex("booking", "idx_booking_influencer_user_id")) {
    try {
      await queryInterface.addIndex("booking", ["influencer_user_id"], {
        name: "idx_booking_influencer_user_id",
      })
    } catch (_) {
      /* ignore */
    }
  }
}

async function down(queryInterface) {
  const dropIndex = async (table, name) => {
    try {
      await queryInterface.removeIndex(table, name)
    } catch (_) {
      /* ignore */
    }
  }
  await dropIndex("booking", "idx_booking_influencer_user_id")
  await dropIndex("user", "idx_user_referred_by_influencer")

  const dropColumn = async (table, column) => {
    try {
      await queryInterface.removeColumn(table, column)
    } catch (_) {
      /* ignore */
    }
  }
  await dropColumn("booking", "influencer_user_id")
  await dropColumn("user", "referred_by_influencer_id")
  await dropColumn("user", "referred_by_code")
  await dropColumn("user", "referred_at")
}

module.exports = { up, down }
