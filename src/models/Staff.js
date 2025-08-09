  // src/models/Staff.js
  import { DataTypes } from "sequelize";

  export default (sequelize) => {
    const Staff = sequelize.define(
      "Staff",
      {
        id: {
          type: DataTypes.INTEGER,
          primaryKey: true,
          autoIncrement: true,
        },
        staff_role_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: "StaffRole", key: "id" },
        },
        name: {
          type: DataTypes.STRING(100),
          allowNull: false,
        },
        email: {
          type: DataTypes.STRING(150),
          allowNull: false,
          unique: true,
          validate: { isEmail: true },
        },
        passwordHash: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        isActive: {
          type: DataTypes.BOOLEAN,
          defaultValue: true,
        },
      },
      {
        tableName      : "staff",
        freezeTableName: true,
        underscored    : true,
        paranoid       : true,
      }
    );

    Staff.associate = (models) => {
      Staff.belongsTo(models.StaffRole, { foreignKey: "staff_role_id", as: "role" });
      Staff.hasOne(models.DiscountCode,     { foreignKey: "staff_id",   as: "discountCode" });
      Staff.hasMany(models.Commission,      { foreignKey: "staff_id",   as: "commissions"  });
      Staff.hasMany(models.Message,         { foreignKey: "staff_id",   as: "messages"     });

      // Un staff puede pertenecer a muchos hoteles
      Staff.belongsToMany(models.Hotel, {
        through    : models.HotelStaff,
        as         : "hotels",
        foreignKey : "staff_id",
        otherKey   : "hotel_id",
      });

      // Un staff puede tener asignados muchos add‑ons
      Staff.belongsToMany(models.HotelAddOn, {
        through    : models.HotelStaffAddOn,
        as         : "addons",
        foreignKey : "staff_id",
        otherKey   : "hotel_add_on_id",
      });
    };

    return Staff;
  };
