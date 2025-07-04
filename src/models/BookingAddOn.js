import { DataTypes } from "sequelize";

export default (sequelize) => {
  const BookingAddOn = sequelize.define(
    "BookingAddOn",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },

      /* —— FK a Booking —— */
      booking_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "Booking", key: "id" },
      },

      /* —— FK a AddOn —— */
      add_on_id: {
        type       : DataTypes.INTEGER,
        allowNull  : false,
        references : { model: "AddOn", key: "id" },
      },

      /* —— Variante elegida (opcional) —— */
      add_on_option_id: {
        type       : DataTypes.INTEGER,
        allowNull  : true,
        references : { model: "add_on_option", key: "id" },
        onDelete   : "SET NULL",
      },

      quantity: {
        type        : DataTypes.INTEGER,
        defaultValue: 1,
      },
    },
    {
      tableName   : "booking_add_on",
      underscored : true,
    }
  );

  /* ─────────── Asociaciones ─────────── */
  BookingAddOn.associate = (models) => {
    BookingAddOn.belongsTo(models.Booking,        { foreignKey: "booking_id",      as: "booking" });
    BookingAddOn.belongsTo(models.AddOn,          { foreignKey: "add_on_id",       as: "addOn"   });
    BookingAddOn.belongsTo(models.AddOnOption,    { foreignKey: "add_on_option_id",as: "option"  });
  };

  return BookingAddOn;
};
