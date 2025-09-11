import { DataTypes } from "sequelize";

export default (sequelize) => {
  const VaultOperatorName = sequelize.define(
    "VaultOperatorName",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      is_used: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      used_by_request_id: { type: DataTypes.INTEGER, allowNull: true },
      used_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "vault_operator_name",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["is_used"] },
      ],
    }
  );

  return VaultOperatorName;
};

