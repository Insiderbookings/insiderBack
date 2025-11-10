import { DataTypes } from "sequelize";

export default (sequelize) => {
  const HomeRecentView = sequelize.define(
    "HomeRecentView",
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
      viewed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "home_recent_view",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          fields: ["user_id", "viewed_at"],
          name: "home_recent_view_user_time_index",
        },
        {
          fields: ["home_id"],
        },
      ],
    }
  );

  HomeRecentView.associate = (models) => {
    HomeRecentView.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    HomeRecentView.belongsTo(models.Home, { foreignKey: "home_id", as: "home" });
  };

  return HomeRecentView;
};
