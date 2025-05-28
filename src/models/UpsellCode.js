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
        references: { model: "AddOn", key: "id" },
      },
      staff_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Staff", key: "id" },
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
    UpsellCode.belongsTo(models.AddOn, { foreignKey: "add_on_id" });
    UpsellCode.belongsTo(models.Staff, { foreignKey: "staff_id" });
  };

  return UpsellCode;
};
