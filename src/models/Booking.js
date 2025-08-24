// src/models/Booking.js
import { DataTypes } from 'sequelize'

export default (sequelize) => {
  const isMySQL = ['mysql', 'mariadb'].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const Booking = sequelize.define(
    'Booking',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      booking_ref: { type: DataTypes.STRING(40), unique: true, allowNull: true },

      user_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'user', key: 'id' } },
      hotel_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'hotel', key: 'id' } },
      tgx_hotel_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'tgx_hotel', key: 'id' }, onDelete: 'SET NULL' },
      room_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'room', key: 'id' } },
      discount_code_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'discount_code', key: 'id' } },

      source: { type: DataTypes.ENUM('TGX', 'PARTNER', 'OUTSIDE'), allowNull: false },

      external_ref: { type: DataTypes.STRING(120) },

      check_in: { type: DataTypes.DATEONLY, allowNull: false },
      check_out: { type: DataTypes.DATEONLY, allowNull: false },
      adults: { type: DataTypes.INTEGER, allowNull: false },
      children: { type: DataTypes.INTEGER, defaultValue: 0 },

      guest_name: { type: DataTypes.STRING(120), allowNull: false },
      guest_email: { type: DataTypes.STRING(150), allowNull: false, validate: { isEmail: true } },
      guest_phone: { type: DataTypes.STRING(50) },

      status: { type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'CANCELLED'), defaultValue: 'PENDING' },
      payment_status: { type: DataTypes.ENUM('UNPAID', 'PAID', 'REFUNDED'), defaultValue: 'UNPAID' },

      gross_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      net_cost: { type: DataTypes.DECIMAL(10, 2) },
      currency: { type: DataTypes.STRING(3), allowNull: false },

      payment_provider: { type: DataTypes.ENUM('STRIPE', 'PAYPAL', 'CARD_ON_FILE'), defaultValue: 'STRIPE' },
      payment_intent_id: { type: DataTypes.STRING(100) },

      booked_at: { type: DataTypes.DATE },
      cancelled_at: { type: DataTypes.DATE },
      rate_expires_at: { type: DataTypes.DATE },

      // 👇 JSONB en Postgres, JSON en MySQL/MariaDB
      meta: { type: JSON_TYPE },
    },
    {
      tableName: 'booking',
      underscored: true,
      freezeTableName: true,
      indexes: [
        // ya marcaste booking_ref como unique arriba; podés borrar este índice o dejarlo si querés
        { fields: ['booking_ref'], unique: true },
        { fields: ['user_id'] },
        { fields: ['hotel_id'] },
        { fields: ['tgx_hotel_id'] },
        { fields: ['status'] },
        { fields: ['payment_status'] },
        { fields: ['source', 'external_ref'] },
      ],
    }
  )

  Booking.associate = (models) => {
    Booking.belongsTo(models.User, { foreignKey: 'user_id' })
    Booking.belongsTo(models.Hotel, { foreignKey: 'hotel_id' })
    Booking.belongsTo(models.TgxHotel, { foreignKey: 'tgx_hotel_id', as: 'tgxHotel' })
    Booking.belongsTo(models.Room, { foreignKey: 'room_id' })
    Booking.belongsTo(models.DiscountCode, { foreignKey: 'discount_code_id' })

    Booking.hasOne(models.Payment, { foreignKey: 'booking_id' })
    Booking.hasOne(models.OutsideMeta, { foreignKey: 'booking_id', as: 'outsideMeta' })
    Booking.hasOne(models.TGXMeta, { foreignKey: 'booking_id', as: 'tgxMeta' })

    Booking.belongsToMany(models.AddOn, { through: models.BookingAddOn, foreignKey: 'booking_id', otherKey: 'add_on_id' })
    Booking.hasMany(models.BookingAddOn, { foreignKey: 'booking_id' })

    if (models.Commission) {
      Booking.hasOne(models.Commission, { foreignKey: 'booking_id' })
    }
  }

  return Booking
}
