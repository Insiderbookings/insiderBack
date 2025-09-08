import { DataTypes } from "sequelize";

export default (sequelize) => {
  const jsonType = sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

  const UserRoleRequest = sequelize.define(
    "UserRoleRequest",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },

      role_requested: {
        type: DataTypes.INTEGER, // 2=influencer, 3=corporate, 4=agency, 1=staff, 0=regular, 5=vault operator
        allowNull: false,
      },

      status: {
        type: DataTypes.ENUM("pending", "needs_info", "submitted", "approved", "rejected"),
        allowNull: false,
        defaultValue: "pending",
      },

      form_data: {
        type: jsonType,
        allowNull: true,
      },
    },
    {
      tableName: "user_role_request",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["user_id"] },
        { fields: ["status"] },
      ],
    }
  );

  UserRoleRequest.associate = (models) => {
    UserRoleRequest.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
  };

  return UserRoleRequest;
};

