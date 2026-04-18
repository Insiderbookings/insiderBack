import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PartnerHotelProfileImage = sequelize.define(
    "PartnerHotelProfileImage",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      partner_hotel_profile_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      source_type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "provider",
      },
      provider_image_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      image_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      caption: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_cover: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "partner_hotel_profile_image",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "idx_partner_hotel_profile_image_profile_sort",
          fields: ["partner_hotel_profile_id", "sort_order"],
        },
        {
          name: "idx_partner_hotel_profile_image_profile_active",
          fields: ["partner_hotel_profile_id", "is_active"],
        },
      ],
    },
  );

  PartnerHotelProfileImage.associate = (models) => {
    PartnerHotelProfileImage.belongsTo(models.PartnerHotelProfile, {
      foreignKey: "partner_hotel_profile_id",
      as: "profile",
    });
  };

  return PartnerHotelProfileImage;
};
