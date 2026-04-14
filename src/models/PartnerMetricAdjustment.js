import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerMetricAdjustment = sequelize.define(
    "PartnerMetricAdjustment",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      claim_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      entered_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      metric_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "bookinggpt_reach",
      },
      source: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "social_manual",
      },
      period_start: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      period_end: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      value: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_metric_adjustment",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "idx_partner_metric_adjustment_hotel_period",
          fields: ["hotel_id", "period_start", "period_end"],
        },
        {
          name: "idx_partner_metric_adjustment_claim",
          fields: ["claim_id"],
        },
        {
          name: "idx_partner_metric_adjustment_metric_type",
          fields: ["metric_type"],
        },
      ],
    },
  );

  PartnerMetricAdjustment.associate = (models) => {
    PartnerMetricAdjustment.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerMetricAdjustment.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    PartnerMetricAdjustment.belongsTo(models.User, {
      foreignKey: "entered_by_user_id",
      as: "enteredBy",
    });
  };

  return PartnerMetricAdjustment;
};
