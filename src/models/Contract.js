import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Contract = sequelize.define(
    "Contract",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      role: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING(180),
        allowNull: false,
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      published_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "contract",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["role", "is_active"] },
        { fields: ["published_at"] },
      ],
    }
  );

  Contract.associate = (models) => {
    Contract.hasMany(models.UserContract, {
      as: "acceptances",
      foreignKey: "contract_id",
      onDelete: "CASCADE",
      hooks: true,
    });
  };

  return Contract;
};
