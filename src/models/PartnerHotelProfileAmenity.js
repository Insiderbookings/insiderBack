import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PartnerHotelProfileAmenity = sequelize.define(
    "PartnerHotelProfileAmenity",
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
      provider_category: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      provider_catalog_code: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      provider_item_id: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      label: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      is_highlighted: {
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
      tableName: "partner_hotel_profile_amenity",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "idx_partner_hotel_profile_amenity_profile_sort",
          fields: ["partner_hotel_profile_id", "sort_order"],
        },
        {
          name: "idx_partner_hotel_profile_amenity_profile_active",
          fields: ["partner_hotel_profile_id", "is_active"],
        },
        {
          name: "idx_partner_hotel_profile_amenity_profile_highlighted",
          fields: ["partner_hotel_profile_id", "is_highlighted"],
        },
      ],
    },
  );

  PartnerHotelProfileAmenity.associate = (models) => {
    PartnerHotelProfileAmenity.belongsTo(models.PartnerHotelProfile, {
      foreignKey: "partner_hotel_profile_id",
      as: "profile",
    });
  };

  return PartnerHotelProfileAmenity;
};
