// src/models/BookingUser.js
import { DataTypes } from "sequelize";

const ROLE_ENUM = ["OWNER", "GUEST"];
const STATUS_ENUM = ["INVITED", "ACCEPTED", "DECLINED", "REMOVED"];

export default (sequelize) => {
  const BookingUser = sequelize.define(
    "BookingUser",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      stay_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
      },
      role: {
        type: DataTypes.ENUM(...ROLE_ENUM),
        allowNull: false,
        defaultValue: "GUEST",
      },
      status: {
        type: DataTypes.ENUM(...STATUS_ENUM),
        allowNull: false,
        defaultValue: "INVITED",
      },
      invited_email: { type: DataTypes.STRING(150), allowNull: true },
      invited_phone: { type: DataTypes.STRING(50), allowNull: true },
      invited_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
      },
      invite_token: { type: DataTypes.STRING(120), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "booking_user",
      underscored: true,
      freezeTableName: true,
      indexes: [
        { unique: true, fields: ["stay_id", "user_id"] },
        { unique: true, fields: ["stay_id", "invited_email"] },
        { unique: true, fields: ["stay_id", "invited_phone"] },
        { fields: ["stay_id"] },
        { fields: ["user_id"] },
        { fields: ["invite_token"] },
        { fields: ["status"] },
      ],
    }
  );

  BookingUser.associate = (models) => {
    BookingUser.belongsTo(models.Stay, {
      foreignKey: "stay_id",
      as: "booking",
    });
    BookingUser.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
  };

  BookingUser.ROLE_ENUM = ROLE_ENUM;
  BookingUser.STATUS_ENUM = STATUS_ENUM;

  return BookingUser;
};
