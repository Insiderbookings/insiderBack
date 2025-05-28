import { DataTypes } from "sequelize";

export default (sequelize) => {
  const AddOn = sequelize.define("AddOn", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    description: DataTypes.TEXT,
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
  });

  AddOn.associate = (models) => {
    AddOn.belongsToMany(models.Booking, {
      through: models.BookingAddOn,
      foreignKey: "add_on_id",
      otherKey: "booking_id",
    });
  };

  return AddOn;
};
