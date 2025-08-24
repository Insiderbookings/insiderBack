// src/models/TGXHotel.js
import { DataTypes } from 'sequelize'

export default (sequelize) => {
  const isMySQLFamily = ['mysql', 'mariadb'].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const TGXHotel = sequelize.define(
    'TGXHotel',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      access: { type: DataTypes.STRING(255), allowNull: false },
      hotel_code: { type: DataTypes.STRING(255), allowNull: false },

      name: { type: DataTypes.STRING(255) },
      category_code: { type: DataTypes.STRING(255) },
      country: { type: DataTypes.STRING(2) },
      city: { type: DataTypes.STRING(255) },
      address: { type: DataTypes.STRING(255) },
      lat: { type: DataTypes.DECIMAL(10, 6) },
      lng: { type: DataTypes.DECIMAL(10, 6) },

      last_synced_at: { type: DataTypes.DATE },

      // JSONB en PG, JSON en MySQL/MariaDB (sin defaultValue)
      meta: { type: JSON_TYPE },
    },
    {
      tableName: 'tgx_hotel',
      underscored: true,
      freezeTableName: true,
      engine: 'InnoDB',
      indexes: [
        { unique: true, fields: ['access', 'hotel_code'] },
        { fields: ['city'] },
        { fields: ['country'] },
      ],
    }
  )

  TGXHotel.associate = (models) => {
    TGXHotel.hasMany(models.Booking, { foreignKey: 'tgx_hotel_id' })
  }

  return TGXHotel
}
