import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeFavoriteList = sequelize.define(
    "HomeFavoriteList",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: "home_favorite_list",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "name"],
          name: "home_favorite_list_user_name_unique",
        },
      ],
    }
  );

  HomeFavoriteList.associate = (models) => {
    HomeFavoriteList.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    HomeFavoriteList.hasMany(models.HomeFavorite, {
      foreignKey: "list_id",
      as: "items",
    });
  };

  return HomeFavoriteList;
};
