import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerEmailLog = sequelize.define(
    "PartnerEmailLog",
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
      email_key: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      schedule_day: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      delivery_status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "SENT",
      },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_email_log",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "uq_partner_email_log_claim_key",
          unique: true,
          fields: ["claim_id", "email_key"],
        },
        {
          name: "idx_partner_email_log_hotel",
          fields: ["hotel_id"],
        },
        {
          name: "idx_partner_email_log_user",
          fields: ["user_id"],
        },
      ],
    },
  );

  PartnerEmailLog.associate = (models) => {
    PartnerEmailLog.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerEmailLog.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    PartnerEmailLog.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
  };

  return PartnerEmailLog;
};
