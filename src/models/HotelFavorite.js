import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HotelFavorite = sequelize.define(
    "HotelFavorite",
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
      list_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "hotel_favorite_list", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "hotel_favorite",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "hotel_id", "list_id"],
          name: "hotel_favorite_user_hotel_list_unique",
        },
      ],
    }
  );

  HotelFavorite.associate = (models) => {
    HotelFavorite.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    if (models.WebbedsHotel) {
      HotelFavorite.belongsTo(models.WebbedsHotel, {
        foreignKey: "hotel_id",
        targetKey: "hotel_id",
        as: "hotel",
      });
    }
    HotelFavorite.belongsTo(models.HotelFavoriteList, {
      foreignKey: "list_id",
      as: "list",
    });
  };

  return HotelFavorite;
};
