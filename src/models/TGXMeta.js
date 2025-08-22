// src/models/TGXMeta.js
import { DataTypes } from 'sequelize';

export default (sequelize) => {
  const TGXMeta = sequelize.define(
    'TGXMeta',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      /* ——— FK a Booking ——— */
      booking_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'booking', key: 'id' },
        onDelete: 'CASCADE'
      },

      /* ——— TravelgateX ——— */
      // rateKey / optionRefId
      option_id: DataTypes.TEXT,

      // Datos de opción / rate
      access:     DataTypes.STRING,
      room_code:  DataTypes.STRING,
      board_code: DataTypes.STRING,
      token:      DataTypes.STRING,

      // <CHANGE> Añadidos campos para cancelación formato 2
      access_code: DataTypes.STRING(50),  // Para cancelación formato 2
      hotel_code:  DataTypes.STRING(50),  // Para cancelación formato 2

      // Referencias reportadas por TGX
      reference_client:        DataTypes.STRING(80),
      reference_supplier:      DataTypes.STRING(80),
      reference_hotel:         DataTypes.STRING(80),

      // ⬇️ NUEVO: bookingID real de TGX (para cancel)
      reference_booking_id:    DataTypes.TEXT,

      // ⬇️ OPCIONAL: referencias adicionales
      supplier_reference:      DataTypes.TEXT,  // si algún seller la devuelve
      cancel_reference:        DataTypes.TEXT,  // cancelReference de cancel()

      // Estado del book en TGX (OK, ON_REQUEST, CANCELLED…)
      book_status: DataTypes.STRING(20),

      // Precio confirmado por TGX
      price_currency: DataTypes.STRING(3),
      price_net:      DataTypes.DECIMAL(10, 2),
      price_gross:    DataTypes.DECIMAL(10, 2),

      // Snapshots para voucher/auditoría
      cancellation_policy: DataTypes.JSONB,
      hotel:               DataTypes.JSONB,
      rooms:               DataTypes.JSONB,

      /* ——— Campo libre ——— */
      meta: DataTypes.JSONB
    },
    {
      tableName: 'tgx_meta',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ['booking_id'] },
        { fields: ['access'] },
        { fields: ['option_id'] },
        // ⬇️ Índice útil para búsquedas por bookingID TGX
        { fields: ['reference_booking_id'] },
        // <CHANGE> Añadidos índices para cancelación
        { fields: ['access_code'] },
        { fields: ['hotel_code'] }
      ]
    }
  );

  TGXMeta.associate = (models) => {
    TGXMeta.belongsTo(models.Booking, { foreignKey: 'booking_id' });
  };

  return TGXMeta;
};
