import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

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
      verification_code: {
        type: DataTypes.STRING(24),
        allowNull: false,
      },
      generated_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      generated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      used_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      used_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
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
          name: "uq_partner_hotel_verification_code_value",
          unique: true,
          fields: ["verification_code"],
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
  };

  return PartnerHotelVerificationCode;
};
