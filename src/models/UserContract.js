import { DataTypes } from "sequelize";

export default (sequelize) => {
  const UserContract = sequelize.define(
    "UserContract",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      contract_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      accepted_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      accepted_ip: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      accepted_user_agent: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "user_contract",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        {
          unique: true,
          fields: ["user_id", "contract_id"],
        },
        { fields: ["contract_id"] },
      ],
    }
  );

  UserContract.associate = (models) => {
    UserContract.belongsTo(models.User, {
      as: "user",
      foreignKey: "user_id",
      onDelete: "CASCADE",
    });
    UserContract.belongsTo(models.Contract, {
      as: "contract",
      foreignKey: "contract_id",
      onDelete: "CASCADE",
      hooks: true,
      paranoid: false,
    });
  };

  return UserContract;
};
