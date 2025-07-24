// src/models/AddOnOption.js
import { DataTypes } from "sequelize"

export default (sequelize) => {
  const AddOnOption = sequelize.define(
    "AddOnOption",
    {
      id: {
        type         : DataTypes.INTEGER,
        primaryKey   : true,
        autoIncrement: true,
      },
      add_on_id: {
        type      : DataTypes.INTEGER,
        allowNull : false,
        references: { model: "add_on", key: "id" },
        onDelete  : "CASCADE",
      },
      name: {
        type     : DataTypes.STRING(120),
        allowNull: false,
      },
      price: {
        type     : DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
    },
    {
      tableName      : "add_on_option",
      freezeTableName: true,
      underscored    : true,
    },
  )

  AddOnOption.associate = (models) => {
    /* ↩ relación many-to-one con AddOn (ya existía) */
    AddOnOption.belongsTo(models.AddOn, { foreignKey: "add_on_id" })

    /* ↪ NUEVO: 1-N con HotelAddOnOption  */
    AddOnOption.hasMany(models.HotelAddOnOption, {
      foreignKey: "add_on_option_id",
    })
  }

  return AddOnOption
}
