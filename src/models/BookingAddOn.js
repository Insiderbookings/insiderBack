import { DataTypes } from "sequelize";

export default (sequelize) => {
  const BookingAddOn = sequelize.define("BookingAddOn", {
     id: {
      type         : DataTypes.INTEGER,
      primaryKey   : true,
      autoIncrement: true,
    },
    booking_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Booking", key: "id" },
      primaryKey: true,
    },
    add_on_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "AddOn", key: "id" },
      primaryKey: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    }
  }, {
    tableName: "booking_add_on",
  });

  return BookingAddOn;
};
