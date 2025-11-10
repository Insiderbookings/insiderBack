import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeFavorite = sequelize.define(
    "HomeFavorite",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      home_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "home", key: "id" },
        onDelete: "CASCADE",
      },
      list_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "home_favorite_list", key: "id" },
        onDelete: "CASCADE",
      },
    },
    {
      tableName: "home_favorite",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "home_id", "list_id"],
          name: "home_favorite_user_home_list_unique",
        },
      ],
    }
  );

  HomeFavorite.associate = (models) => {
    HomeFavorite.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    HomeFavorite.belongsTo(models.Home, { foreignKey: "home_id", as: "home" });
    HomeFavorite.belongsTo(models.HomeFavoriteList, {
      foreignKey: "list_id",
      as: "list",
    });
  };

  return HomeFavorite;
};
