import { DataTypes } from "sequelize";

export default (sequelize) => {
  const UpsellCode = sequelize.define(
    "UpsellCode",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      room_number: {
        type: DataTypes.STRING(10),
        allowNull: false,
      },
      add_on_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "add_on", key: "id" },
        onDelete: "NO ACTION",
      },
      // Nuevo: referencia a la opción seleccionada (si aplica)
      add_on_option_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "add_on_option", key: "id" },
        onDelete: "SET NULL",
      },
      // Nuevo: precio final con el que se generó el código
      price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
      },
      qty: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
      staff_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "staff", key: "id" },
      },
      code: {
        type: DataTypes.STRING(6),
        allowNull: false,
        unique: true,
      },
      status: {
        type: DataTypes.ENUM("pending", "used", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "upsell_codes",
      underscored: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  UpsellCode.associate = (models) => {
    UpsellCode.belongsTo(models.AddOn, {
      foreignKey: "add_on_id",
      as: "addOn",
    });
    UpsellCode.belongsTo(models.Staff, {
      foreignKey: "staff_id",
      as: "staff",
    });
    // Asociación a la opción de add-on
    UpsellCode.belongsTo(models.AddOnOption, {
      foreignKey: "add_on_option_id",
      as: "selectedOption",
    });
  };

  return UpsellCode;
};
