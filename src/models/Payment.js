// src/models/Payment.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
    const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
    const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

    const Payment = sequelize.define(
        "Payment",
        {
            /* ───────── PK ───────── */
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            /* ─────── FK a Booking ─────── */
            // Dejo el tipo pero SIN references; la FK la agrega la asociación
            booking_id: { type: DataTypes.INTEGER, allowNull: false },

            /* ─────── Datos Stripe / VCC ─────── */
            stripe_payment_intent_id: { type: DataTypes.STRING(255) },
            stripe_charge_id: { type: DataTypes.STRING(255) },
            vcc_last4: { type: DataTypes.STRING(4) },
            vcc_token: { type: DataTypes.STRING(255) },

            /* ─────── Importes ─────── */
            amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
            currency: { type: DataTypes.STRING(3), allowNull: false },

            /* ─────── Estado ─────── */
            status: {
                type: DataTypes.ENUM("INIT", "CAPTURED", "FAILED", "REFUNDED"),
                defaultValue: "INIT",
            },

            /* ─────── Campo libre ─────── */
            // JSONB en PG, JSON en MySQL/MariaDB. Evitá defaultValue acá.
            meta: { type: JSON_TYPE },
        },
        {
            tableName: "payment",
            underscored: true,
            freezeTableName: true,
            // opcionalmente:
            engine: "InnoDB",
            indexes: [{ fields: ["booking_id"] }],
        }
    );

    /* ─────── Asociaciones ─────── */
    Payment.associate = (models) => {
        Payment.belongsTo(models.Booking, {
            foreignKey: "booking_id",
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
            constraints: true,
        });
    };

    return Payment;
};
