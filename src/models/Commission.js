import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Commission = sequelize.define("Commission", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    stay_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: { model: "booking", key: "id" },
    },
    // Compat: aceptar booking_id y mapearlo a stay_id
    booking_id: {
      type: DataTypes.VIRTUAL,
      set(value) {
        if (value != null) this.setDataValue("stay_id", value);
      },
      get() {
        return this.getDataValue("stay_id");
      },
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
    Commission.belongsTo(models.Stay, { foreignKey: "stay_id", as: "stay" });
    Commission.belongsTo(models.Staff, { foreignKey: "staff_id", as: "staff" });
  };

  return Commission;
};
