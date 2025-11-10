// src/models/HotelAlias.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const HotelAlias = sequelize.define(
    "HotelAlias",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "hotel", key: "id" },
        onDelete: "CASCADE",
      },
      provider: { type: DataTypes.STRING(40), allowNull: false },
      provider_hotel_id: { type: DataTypes.STRING(120), allowNull: false },
      confidence: {
        type: DataTypes.DECIMAL(5, 4),
        allowNull: false,
        defaultValue: 0,
      },
      needs_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      matched_at: { type: DataTypes.DATE },
      metadata: { type: JSON_TYPE, allowNull: true },
    },
    {
      tableName: "hotel_alias",
      freezeTableName: true,
      underscored: true,
      paranoid: false,
      indexes: [
        {
          unique: true,
          fields: ["provider", "provider_hotel_id"],
          name: "uq_hotel_alias_provider_id",
        },
        {
          fields: ["hotel_id"],
          name: "idx_hotel_alias_hotel",
        },
        {
          fields: ["needs_review"],
          name: "idx_hotel_alias_review",
        },
      ],
    },
  );

  HotelAlias.associate = (models) => {
    HotelAlias.belongsTo(models.Hotel, {
      foreignKey: "hotel_id",
      as: "hotel",
      onDelete: "CASCADE",
    });
  };

  return HotelAlias;
};

