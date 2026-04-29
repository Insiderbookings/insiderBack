import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerHotelClaim = sequelize.define(
    "PartnerHotelClaim",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      claim_status: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "TRIAL_ACTIVE",
      },
      onboarding_step: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      contact_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      contact_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      contact_phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      claimed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      trial_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      trial_ends_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      current_plan_code: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      pending_plan_code: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      billing_method: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      stripe_customer_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      stripe_subscription_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      stripe_checkout_session_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      stripe_price_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      stripe_invoice_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      subscription_status: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      subscription_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      next_billing_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      invoice_requested_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      invoice_paid_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_badge_activated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      badge_removed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      billing_details: {
        type: JSON_TYPE,
        allowNull: true,
      },
      profile_overrides: {
        type: JSON_TYPE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
      internal_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "partner_hotel_claim",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        {
          name: "uq_partner_hotel_claim_hotel",
          unique: true,
          fields: ["hotel_id"],
        },
        {
          name: "idx_partner_hotel_claim_user",
          fields: ["user_id"],
        },
        {
          name: "idx_partner_hotel_claim_status",
          fields: ["claim_status"],
        },
        {
          name: "idx_partner_hotel_claim_trial_end",
          fields: ["trial_ends_at"],
        },
      ],
    },
  );

  PartnerHotelClaim.associate = (models) => {
    PartnerHotelClaim.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    PartnerHotelClaim.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    if (models.PartnerEmailLog) {
      PartnerHotelClaim.hasMany(models.PartnerEmailLog, {
        foreignKey: "claim_id",
        as: "emailLogs",
        onDelete: "CASCADE",
      });
    }
    if (models.PartnerHotelProfile) {
      PartnerHotelClaim.hasOne(models.PartnerHotelProfile, {
        foreignKey: "claim_id",
        as: "hotelProfile",
        onDelete: "CASCADE",
      });
    }
    if (models.PartnerHotelInquiry) {
      PartnerHotelClaim.hasMany(models.PartnerHotelInquiry, {
        foreignKey: "claim_id",
        as: "inquiries",
        onDelete: "CASCADE",
      });
    }
    if (models.PartnerMonthlyReport) {
      PartnerHotelClaim.hasMany(models.PartnerMonthlyReport, {
        foreignKey: "claim_id",
        as: "monthlyReports",
        onDelete: "CASCADE",
      });
    }
  };

  return PartnerHotelClaim;
};
