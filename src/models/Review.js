// src/models/Review.js
import { DataTypes } from "sequelize";

const AUTHOR_TYPES = ["GUEST", "HOST"];
const TARGET_TYPES = ["HOME", "HOST", "GUEST"];
const REVIEW_STATUSES = ["PENDING", "PUBLISHED", "HIDDEN"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const isMySQLFamily = ["mysql", "mariadb"].includes(dialect);
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const Review = sequelize.define(
    "Review",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      booking_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      home_id: { type: DataTypes.INTEGER, allowNull: true },
      host_id: { type: DataTypes.INTEGER, allowNull: true },
      guest_id: { type: DataTypes.INTEGER, allowNull: true },

      author_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      author_type: {
        type: DataTypes.ENUM(...AUTHOR_TYPES),
        allowNull: false,
      },
      target_type: {
        type: DataTypes.ENUM(...TARGET_TYPES),
        allowNull: false,
        defaultValue: "HOME",
      },

      rating_overall: { type: DataTypes.DECIMAL(3, 2), allowNull: false },
      rating_cleanliness: { type: DataTypes.DECIMAL(3, 2) },
      rating_communication: { type: DataTypes.DECIMAL(3, 2) },
      rating_accuracy: { type: DataTypes.DECIMAL(3, 2) },
      rating_value: { type: DataTypes.DECIMAL(3, 2) },
      rating_location: { type: DataTypes.DECIMAL(3, 2) },

      comment: { type: DataTypes.TEXT },
      metadata: { type: JSON_TYPE },

      status: {
        type: DataTypes.ENUM(...REVIEW_STATUSES),
        defaultValue: "PUBLISHED",
      },
      published_at: { type: DataTypes.DATE },
      visible_at: { type: DataTypes.DATE },
    },
    {
      tableName: "review",
      underscored: true,
      freezeTableName: true,
      paranoid: true,
      indexes: [
        { fields: ["booking_id"], unique: false },
        { fields: ["home_id"] },
        { fields: ["host_id"] },
        { fields: ["guest_id"] },
        { fields: ["author_id"] },
        { fields: ["status"] },
      ],
    }
  );

  Review.associate = (models) => {
    if (models.Booking) {
      Review.belongsTo(models.Booking, { foreignKey: "booking_id", as: "booking" });
    }
    if (models.Home) {
      Review.belongsTo(models.Home, { foreignKey: "home_id", as: "home" });
    }
    if (models.User) {
      Review.belongsTo(models.User, { foreignKey: "author_id", as: "author" });
      Review.belongsTo(models.User, { foreignKey: "guest_id", as: "guest" });
      Review.belongsTo(models.User, { foreignKey: "host_id", as: "host" });
    }
  };

  return Review;
};
