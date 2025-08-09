import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Commission = sequelize.define("Commission", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    booking_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "booking", key: "id" },
    },
    staff_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "staff", key: "id" },
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("pending", "paid"),
      defaultValue: "pending",
    },
    paidAt: DataTypes.DATE,
  });

  Commission.associate = (models) => {
    Commission.belongsTo(models.Booking, { foreignKey: "booking_id", as: "booking" });
    Commission.belongsTo(models.Staff, { foreignKey: "staff_id", as: "staff" });
  };

  return Commission;
};
