import { DataTypes } from 'sequelize'

export default (sequelize) => {
    const WcTemplate = sequelize.define('WcTemplate', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        // clave estable para usar en código/render (no cambia)
        key: { type: DataTypes.STRING(64), allowNull: false, unique: true }, // ej: 'classic'

        name: { type: DataTypes.STRING(120), allowNull: false },             // ej: 'Clásico'
        description: { type: DataTypes.TEXT, allowNull: true },
        version: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '1.0.0' },

        // URLs opcionales para catálogo/preview
        preview_image: { type: DataTypes.STRING(255), allowNull: true },
        demo_url: { type: DataTypes.STRING(255), allowNull: true },

        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        tableName: 'wc_template',
        freezeTableName: true,
        underscored: true,
        paranoid: true,
        indexes: [{ unique: true, fields: ['key'] }]
    })

    WcTemplate.associate = (models) => {
        // nada obligatorio; es catálogo
    }

    return WcTemplate
}
