// src/models/StayManual.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const StayManual = sequelize.define(
    "StayManual",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      operator_id: { type: DataTypes.INTEGER, allowNull: true },
      tenant_id: { type: DataTypes.INTEGER, allowNull: true },
      notes: { type: DataTypes.TEXT },
      attachments: { type: DataTypes.JSON },
      extras: { type: DataTypes.JSON },
    },
    {
      tableName: "stay_manual",
      underscored: true,
      freezeTableName: true,
    }
  );

  StayManual.associate = (models) => {
    StayManual.belongsTo(models.Stay, { foreignKey: "stay_id" });
  };

  return StayManual;
};
