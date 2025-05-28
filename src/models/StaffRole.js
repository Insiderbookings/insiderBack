import { DataTypes } from "sequelize";

export default (sequelize) => {
  const StaffRole = sequelize.define("StaffRole", {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },
    defaultDiscountPct: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 10, max: 25 },
    },
    commissionPct: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 50 },
    },
  });

  StaffRole.associate = (models) => {
    StaffRole.hasMany(models.Staff, { foreignKey: "staff_role_id" });
  };

  return StaffRole;
};
