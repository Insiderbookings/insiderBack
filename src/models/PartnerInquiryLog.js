import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerInquiryLog = sequelize.define(
    "PartnerInquiryLog",
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
      traveler_name: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      traveler_email: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      traveler_phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      check_in: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      check_out: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      source_surface: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_inquiry_log",
      freezeTableName: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        {
          name: "idx_partner_inquiry_log_claim_created",
          fields: ["claim_id", "created_at"],
        },
        {
          name: "idx_partner_inquiry_log_hotel_created",
          fields: ["hotel_id", "created_at"],
        },
      ],
    },
  );

  PartnerInquiryLog.associate = (models) => {
    PartnerInquiryLog.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerInquiryLog.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
  };

  return PartnerInquiryLog;
};
