    // src/models/Payment.js
    import { DataTypes } from "sequelize";

    export default (sequelize) => {
    const Payment = sequelize.define(
        "Payment",
        {
        /* ───────── PK ───────── */
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        /* ─────── FK a Booking ─────── */
        booking_id: {
            type       : DataTypes.INTEGER,
            allowNull  : false,
            references : { model: "booking", key: "id" },
            onDelete   : "CASCADE",
        },

        /* ─────── Datos Stripe / VCC ─────── */
        stripe_payment_intent_id: DataTypes.STRING,  // pi_***
        stripe_charge_id       : DataTypes.STRING,  // ch_*** (si capturas)
        vcc_last4              : DataTypes.STRING(4),
        vcc_token              : DataTypes.STRING,   // referencia en bóveda/tipo PAN tokenizado

        /* ─────── Importes ─────── */
        amount   : { type: DataTypes.DECIMAL(10, 2), allowNull: false },
        currency : { type: DataTypes.STRING(3),      allowNull: false },

        /* ─────── Estado ─────── */
        status: {
            type        : DataTypes.ENUM("INIT", "CAPTURED", "FAILED", "REFUNDED"),
            defaultValue: "INIT",
        },

        /* ─────── Campo libre ─────── */
        meta: DataTypes.JSONB,
        },
        {
        tableName      : "payment",
        underscored    : true,
        freezeTableName: true,
        }
    );

    /* ─────── Asociaciones ─────── */
    Payment.associate = (models) => {
        Payment.belongsTo(models.Booking, { foreignKey: "booking_id" });
    };

    return Payment;
    };
