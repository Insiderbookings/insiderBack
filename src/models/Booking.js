// src/models/Booking.js
import { DataTypes } from 'sequelize'

export default (sequelize) => {
  const Booking = sequelize.define(
    'Booking',
    {
      /* ──────────────────── PK ──────────────────── */
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* ───────────── Identificador cruzado ───────────── */
      booking_ref: { type: DataTypes.STRING(40), unique: true, allowNull: true },

      /* ──────────── Relaciones básicas ──────────── */
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true, // null = huésped invitado
        references: { model: 'user', key: 'id' }
      },

      // Hoteles propios/partners (puede ser null si es TGX)
      hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: true, // <- AHORA puede ser null porque usamos tgx_hotel_id para TGX
        references: { model: 'hotel', key: 'id' }
      },

      // Hoteles de TravelgateX (nuevo)
      tgx_hotel_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'tgx_hotel', key: 'id' },
        onDelete: 'SET NULL'
      },

      room_id: {
        type: DataTypes.INTEGER,
        allowNull: true, // puede ser null en OUTSIDE o si la room es TGX sin mapeo local
        references: { model: 'room', key: 'id' }
      },

      discount_code_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'discount_code', key: 'id' }
      },

      /* ─────────────── Origen de la reserva ─────────────── */
      source: {
        type: DataTypes.ENUM('TGX', 'PARTNER', 'OUTSIDE'),
        allowNull: false
      },

      // Sugerencia: guardar aquí el localizador final del proveedor (ej. locator TGX)
      external_ref: DataTypes.STRING(120),

      /* ─── Fechas & ocupación ─── */
      check_in:  { type: DataTypes.DATEONLY, allowNull: false },
      check_out: { type: DataTypes.DATEONLY, allowNull: false },
      adults:    { type: DataTypes.INTEGER, allowNull: false },
      children:  { type: DataTypes.INTEGER, defaultValue: 0 },

      /* ─── Datos del huésped ─── */
      guest_name:  { type: DataTypes.STRING(120), allowNull: false },
      guest_email: { type: DataTypes.STRING(150), allowNull: false, validate: { isEmail: true } },
      guest_phone: DataTypes.STRING(50),

      /* ─── Estado & pago ─── */
      status: {
        type: DataTypes.ENUM('PENDING', 'CONFIRMED', 'CANCELLED'),
        defaultValue: 'PENDING'
      },
      payment_status: {
        type: DataTypes.ENUM('UNPAID', 'PAID', 'REFUNDED'),
        defaultValue: 'UNPAID'
      },

      // Importe cobrado al huésped y coste neto (si aplica)
      gross_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      net_cost:    { type: DataTypes.DECIMAL(10, 2) },
      currency:    { type: DataTypes.STRING(3), allowNull: false },

      /* ─── Info de medios de pago ─── */
      payment_provider: {
        type: DataTypes.ENUM('STRIPE', 'PAYPAL'),
        defaultValue: 'STRIPE'
      },
      payment_intent_id: { type: DataTypes.STRING(100) }, // ej. pi_xxx (Stripe) u otro id del PSP

      /* ─── Timestamps de negocio ─── */
      booked_at:    { type: DataTypes.DATE },
      cancelled_at: { type: DataTypes.DATE },

      /* ─── Ayuda para opciones que expiran ─── */
      rate_expires_at: { type: DataTypes.DATE },

      /* ───── Campo libre para extensiones futuras ───── */
      meta: DataTypes.JSONB
    },
    {
      tableName: 'booking',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ['booking_ref'], unique: true },
        { fields: ['user_id'] },
        { fields: ['hotel_id'] },
        { fields: ['tgx_hotel_id'] },
        { fields: ['status'] },
        { fields: ['payment_status'] }
      ],
      // Regla de negocio sugerida (a nivel servicio):
      // - Debe venir hotel_id (partner) O tgx_hotel_id (TGX)
    }
  )

  /* ─────────────────── Asociaciones ─────────────────── */
  Booking.associate = (models) => {
    /* FK directas */
    Booking.belongsTo(models.User,  { foreignKey: 'user_id' })
    Booking.belongsTo(models.Hotel, { foreignKey: 'hotel_id' })
    Booking.belongsTo(models.TgxHotel, { foreignKey: 'tgx_hotel_id', as: 'tgxHotel' })
    Booking.belongsTo(models.Room,  { foreignKey: 'room_id' })
    Booking.belongsTo(models.DiscountCode, { foreignKey: 'discount_code_id' })

    /* Pagos y metadatos específicos por canal */
    Booking.hasOne(models.Payment, { foreignKey: 'booking_id' })
    Booking.hasOne(models.OutsideMeta, { foreignKey: 'booking_id', as: 'outsideMeta' })
    Booking.hasOne(models.TGXMeta,     { foreignKey: 'booking_id', as: 'tgxMeta' })

    /* Perks / Add-ons */
    Booking.belongsToMany(models.AddOn, {
      through: models.BookingAddOn,
      foreignKey: 'booking_id',
      otherKey: 'add_on_id'
    })
    Booking.hasMany(models.BookingAddOn, { foreignKey: 'booking_id' })

    /* Comisión (si la manejas aparte) */
    if (models.Commission) {
      Booking.hasOne(models.Commission, { foreignKey: 'booking_id' })
    }
  }

  return Booking
}
