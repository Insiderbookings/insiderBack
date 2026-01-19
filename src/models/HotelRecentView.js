import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelRecentView = sequelize.define(
    "HotelRecentView",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: "webbeds_hotel", key: "hotel_id" },
        onDelete: "CASCADE",
      },
      viewed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "hotel_recent_view",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          fields: ["user_id", "viewed_at"],
          name: "hotel_recent_view_user_time_index",
        },
        {
          fields: ["hotel_id"],
        },
      ],
    }
  );

  HotelRecentView.associate = (models) => {
    HotelRecentView.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    if (models.WebbedsHotel) {
      HotelRecentView.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      });
    }
  };

  return HotelRecentView;
};
