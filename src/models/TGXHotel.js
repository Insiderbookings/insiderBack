// src/models/TGXHotel.js
import { DataTypes } from 'sequelize'

export default (sequelize) => {
  const TGXHotel = sequelize.define(
    'TGXHotel',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // TravelgateX access (supplier / contrato)
      access: { type: DataTypes.STRING, allowNull: false },

      // Código de hotel de TGX (hotelCode)
      hotel_code: { type: DataTypes.STRING, allowNull: false },

      name:          DataTypes.STRING,
      category_code: DataTypes.STRING,
      country:       DataTypes.STRING(2),
      city:          DataTypes.STRING,
      address:       DataTypes.STRING,
      lat:           DataTypes.DECIMAL(10, 6),
      lng:           DataTypes.DECIMAL(10, 6),

      last_synced_at: DataTypes.DATE,

      // snapshot libre (puede incluir location completa, contactos, medias, etc.)
      meta: DataTypes.JSONB
    },
    {
      tableName: 'tgx_hotel',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { unique: true, fields: ['access', 'hotel_code'] },
        { fields: ['city'] },
        { fields: ['country'] }
      ]
    }
  )

  TGXHotel.associate = (models) => {
    TGXHotel.hasMany(models.Booking, { foreignKey: 'tgx_hotel_id' })
  }

  return TGXHotel
}
