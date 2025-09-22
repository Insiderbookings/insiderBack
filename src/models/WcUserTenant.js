import { DataTypes } from "sequelize";

export default (sequelize) => {
  const WcUserTenant = sequelize.define(
    "WcUserTenant",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.INTEGER, allowNull: false },
      tenant_id: { type: DataTypes.INTEGER, allowNull: false },
      created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    },
    {
      tableName: "wc_user_tenant",
      freezeTableName: true,
      underscored: true,
      indexes: [
        { unique: true, fields: ["user_id", "tenant_id"] },
      ],
    }
  );

  WcUserTenant.associate = (models) => {
    if (models.User && models.WcTenant) {
      models.User.belongsToMany(models.WcTenant, {
        through: WcUserTenant,
        foreignKey: "user_id",
        otherKey: "tenant_id",
      })
      models.WcTenant.belongsToMany(models.User, {
        through: WcUserTenant,
        foreignKey: "tenant_id",
        otherKey: "user_id",
      })
    }
  }

  return WcUserTenant;
}

