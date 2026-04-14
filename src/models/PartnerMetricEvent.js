import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerMetricEvent = sequelize.define(
    "PartnerMetricEvent",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      claim_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      session_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      dedupe_key: {
        type: DataTypes.STRING(191),
        allowNull: true,
      },
      event_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      surface: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      placement: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      source_channel: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "in_app",
      },
      page_path: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      referrer: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_metric_event",
      freezeTableName: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        {
          name: "idx_partner_metric_event_claim",
          fields: ["claim_id"],
        },
        {
          name: "idx_partner_metric_event_hotel_created",
          fields: ["hotel_id", "created_at"],
        },
        {
          name: "idx_partner_metric_event_surface_type",
          fields: ["surface", "event_type"],
        },
        {
          name: "uq_partner_metric_event_dedupe",
          unique: true,
          fields: ["dedupe_key"],
        },
      ],
    },
  );

  PartnerMetricEvent.associate = (models) => {
    PartnerMetricEvent.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerMetricEvent.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    PartnerMetricEvent.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  return PartnerMetricEvent;
};
