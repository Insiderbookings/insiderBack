// src/models/Home.js
import { DataTypes } from "sequelize";

const PROPERTY_TYPES = [
  "HOUSE",
  "APARTMENT",
  "BARN",
  "BOAT",
  "CABIN",
  "CARAVAN",
  "B_AND_B",
  "TINY_HOUSE",
  "OTHER",
];

const SPACE_TYPES = ["ENTIRE_PLACE", "PRIVATE_ROOM", "SHARED_ROOM"];

export default (sequelize) => {
  const Home = sequelize.define(
    "Home",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      host_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
      },
      status: {
        type: DataTypes.ENUM("DRAFT", "IN_REVIEW", "PUBLISHED", "SUSPENDED"),
        defaultValue: "DRAFT",
      },
      draft_step: { type: DataTypes.INTEGER, defaultValue: 1 },
      title: { type: DataTypes.STRING(120) },
      description: { type: DataTypes.TEXT },
      property_type: {
        type: DataTypes.ENUM(...PROPERTY_TYPES),
        allowNull: false,
        defaultValue: "HOUSE",
      },
      space_type: {
        type: DataTypes.ENUM(...SPACE_TYPES),
        allowNull: false,
        defaultValue: "ENTIRE_PLACE",
      },
      listing_type: {
        type: DataTypes.ENUM("STANDARD", "EXPERIENCE", "SERVICE"),
        defaultValue: "STANDARD",
      },
      max_guests: { type: DataTypes.INTEGER, defaultValue: 1 },
      bedrooms: { type: DataTypes.INTEGER, defaultValue: 1 },
      beds: { type: DataTypes.INTEGER, defaultValue: 1 },
      bathrooms: { type: DataTypes.DECIMAL(3, 1), defaultValue: 1 },
      allow_shared_spaces: { type: DataTypes.BOOLEAN, defaultValue: false },
      is_visible: { type: DataTypes.BOOLEAN, defaultValue: false },
      marketing_tags: { type: DataTypes.JSON },
    },
    {
      tableName: "home",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
    }
  );

  Home.associate = (models) => {
    Home.belongsTo(models.User, { foreignKey: "host_id", as: "host" });
    Home.hasOne(models.HomeAddress, { foreignKey: "home_id", as: "address" });
    Home.hasOne(models.HomePricing, { foreignKey: "home_id", as: "pricing" });
    Home.hasOne(models.HomePolicies, { foreignKey: "home_id", as: "policies" });
    Home.hasOne(models.HomeSecurity, { foreignKey: "home_id", as: "security" });
    Home.hasMany(models.HomeMedia, { foreignKey: "home_id", as: "media" });
    Home.hasMany(models.HomeAmenityLink, { foreignKey: "home_id", as: "amenities" });
    Home.hasMany(models.HomeTagLink, { foreignKey: "home_id", as: "tags" });
    Home.hasMany(models.HomeCalendar, { foreignKey: "home_id", as: "calendar" });
    Home.hasMany(models.HomeDiscountRule, { foreignKey: "home_id", as: "discounts" });
    Home.hasMany(models.HomeFeature, { foreignKey: "home_id", as: "features" });
  };

  return Home;
};
