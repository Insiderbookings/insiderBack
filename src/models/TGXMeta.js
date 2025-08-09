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

      /* ——— Datos específicos de TravelgateX ——— */
      // optionRefId puede ser largo → TEXT para evitar truncados
      option_id: DataTypes.TEXT,
      room_code:  DataTypes.STRING, // código de habitación
      board_code: DataTypes.STRING, // plan (BB, HB…)
      token:      DataTypes.STRING, // token de paginado (si lo necesitás)
      access:     DataTypes.STRING, // supplier access

      // Guardar snapshot de política/condiciones para auditoría
      cancellation_policy: DataTypes.JSONB,

      /* ——— Campo libre ——— */
      meta: DataTypes.JSONB
    },
    {
      tableName: 'tgx_meta',
      underscored: true,
      freezeTableName: true,
      indexes: [
        { fields: ['booking_id'] },
        { fields: ['access'] }
      ]
    }
  );

  /* ——— Asociaciones ——— */
  TGXMeta.associate = (models) => {
    TGXMeta.belongsTo(models.Booking, { foreignKey: 'booking_id' });
  };

  return TGXMeta;
};
