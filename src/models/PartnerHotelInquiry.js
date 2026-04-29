import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerHotelInquiry = sequelize.define(
    "PartnerHotelInquiry",
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
      claim_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      traveler_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
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
      check_in: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      check_out: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      guests_summary: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      inquiry_message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      source_surface: {
        type: DataTypes.STRING(40),
        allowNull: false,
        defaultValue: "hotel_detail",
      },
      delivery_status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "PENDING",
      },
      delivered_to_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      delivered_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_hotel_inquiry",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "idx_partner_hotel_inquiry_claim",
          fields: ["claim_id"],
        },
        {
          name: "idx_partner_hotel_inquiry_hotel",
          fields: ["hotel_id"],
        },
        {
          name: "idx_partner_hotel_inquiry_traveler_user",
          fields: ["traveler_user_id"],
        },
        {
          name: "idx_partner_hotel_inquiry_delivery_status",
          fields: ["delivery_status"],
        },
      ],
    },
  );

  PartnerHotelInquiry.associate = (models) => {
    PartnerHotelInquiry.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerHotelInquiry.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    if (models.User) {
      PartnerHotelInquiry.belongsTo(models.User, {
        foreignKey: "traveler_user_id",
        as: "travelerUser",
      });
    }
  };

  return PartnerHotelInquiry;
};
