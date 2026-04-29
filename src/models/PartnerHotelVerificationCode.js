import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PartnerHotelVerificationCode = sequelize.define(
    "PartnerHotelVerificationCode",
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
      code: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      created_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      claimed_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      claimed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_hotel_verification_code",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "uq_partner_hotel_verification_code_hotel",
          unique: true,
          fields: ["hotel_id"],
        },
        {
          name: "uq_partner_hotel_verification_code_code",
          unique: true,
          fields: ["code"],
        },
        {
          name: "idx_partner_hotel_verification_code_created_by_user",
          fields: ["created_by_user_id"],
        },
        {
          name: "idx_partner_hotel_verification_code_claimed_by_user",
          fields: ["claimed_by_user_id"],
        },
      ],
    },
  );

  PartnerHotelVerificationCode.associate = (models) => {
    PartnerHotelVerificationCode.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    if (models.User) {
      PartnerHotelVerificationCode.belongsTo(models.User, {
        foreignKey: "created_by_user_id",
        as: "createdByUser",
      });
      PartnerHotelVerificationCode.belongsTo(models.User, {
        foreignKey: "claimed_by_user_id",
        as: "claimedByUser",
      });
    }
  };

  return PartnerHotelVerificationCode;
};
