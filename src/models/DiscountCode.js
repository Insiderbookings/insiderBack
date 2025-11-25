// src/models/DiscountCode.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const DiscountCode = sequelize.define(
    "DiscountCode",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      code: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: { len: [1, 16], is: /^[A-Z0-9]+$/i },
      },

      percentage: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { isInt: true, min: 1, max: 100 },
      },

      special_discount_price: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: { isInt: true, min: 10, max: 200000 },
      },

      default: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      // Opcional: asociado a staff
      staff_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "staff", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      // Opcional: asociado a un usuario
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      // Enlaza el código con la stay donde se usó
      stay_id: {
        type: DataTypes.INTEGER,
        references: { model: "booking", key: "id" },
      },
      booking_id: {
        type: DataTypes.VIRTUAL,
        set(value) {
          if (value != null) this.setDataValue("stay_id", value);
        },
        get() {
          return this.getDataValue("stay_id");
        },
      },

      starts_at: DataTypes.DATE,
      ends_at: DataTypes.DATE,
      max_uses: DataTypes.INTEGER,
      times_used: { type: DataTypes.INTEGER, defaultValue: 0 },
    },
    {
      tableName: "discount_code",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      validate: {
        staffOrUser() {
          const hasStaff = !!this.staff_id;
          const hasUser = !!this.user_id;
          if (!hasStaff && !hasUser) {
            throw new Error("Either staff_id or user_id must be provided.");
          }
        },
      },
    }
  );

  DiscountCode.associate = (models) => {
    DiscountCode.belongsTo(models.Staff, {
      foreignKey: "staff_id",
      as: "staff",
    });
    DiscountCode.belongsTo(models.User, {
      foreignKey: "user_id",
      as: "user",
    });
    DiscountCode.belongsTo(models.Stay, {
      foreignKey: "stay_id",
      as: "stay",
    });
  };

  return DiscountCode;
};
