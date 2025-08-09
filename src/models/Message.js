import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Message = sequelize.define("Message", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "user", key: "id" },
    },
    staff_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "staff", key: "id" },
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  });

  Message.associate = (models) => {
    Message.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    Message.belongsTo(models.Staff, { foreignKey: "staff_id", as: "staff" });
  };

  return Message;
};
