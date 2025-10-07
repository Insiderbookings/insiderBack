// src/models/TGXMeta.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const TGXMeta = sequelize.define(
    "TGXMeta",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      stay_id: { type: DataTypes.INTEGER, allowNull: true },
      booking_id: { type: DataTypes.INTEGER, allowNull: true },

      option_id: DataTypes.TEXT,

      access: DataTypes.STRING,
      room_code: DataTypes.STRING,
      board_code: DataTypes.STRING,
      token: DataTypes.STRING,

      access_code: DataTypes.STRING(50),
      hotel_code: DataTypes.STRING(50),

      reference_client: DataTypes.STRING(80),
      reference_supplier: DataTypes.STRING(80),
      reference_hotel: DataTypes.STRING(80),

      reference_booking_id: DataTypes.TEXT,
      supplier_reference: DataTypes.TEXT,
      cancel_reference: DataTypes.TEXT,

      book_status: DataTypes.STRING(20),

      price_currency: DataTypes.STRING(3),
      price_net: DataTypes.DECIMAL(10, 2),
      price_gross: DataTypes.DECIMAL(10, 2),

      cancellation_policy: { type: JSON_TYPE },
      hotel: { type: JSON_TYPE },
      rooms: { type: JSON_TYPE },

      meta: { type: JSON_TYPE },
    },
    {
      tableName: "tgx_meta",
      underscored: true,
      freezeTableName: true,
      engine: "InnoDB",
      indexes: [
        { fields: ["stay_id"] },
        { fields: ["booking_id"] },
        { fields: ["access"] },
        { fields: ["option_id"] },
        { fields: ["reference_booking_id"] },
        { fields: ["access_code"] },
        { fields: ["hotel_code"] },
      ],
    }
  );

  TGXMeta.addHook("beforeSave", (instance) => {
    if (instance.stay_id == null && instance.booking_id != null) instance.stay_id = instance.booking_id;
    if (instance.booking_id == null && instance.stay_id != null) instance.booking_id = instance.stay_id;
  });

  TGXMeta.associate = (models) => {
    TGXMeta.belongsTo(models.Stay, {
      foreignKey: "stay_id",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
      constraints: true,
    });
  };

  return TGXMeta;
};
