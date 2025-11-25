// src/models/Payment.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
    const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
    const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

    const Payment = sequelize.define(
        "Payment",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            stay_id: { type: DataTypes.INTEGER, allowNull: false },
            // Compat: aceptar booking_id y mapearlo a stay_id
            booking_id: {
                type: DataTypes.VIRTUAL,
                set(value) {
                    if (value != null) this.setDataValue("stay_id", value);
                },
                get() {
                    return this.getDataValue("stay_id");
                },
            },

            stripe_payment_intent_id: { type: DataTypes.STRING(255) },
            stripe_charge_id: { type: DataTypes.STRING(255) },
            vcc_last4: { type: DataTypes.STRING(4) },
            vcc_token: { type: DataTypes.STRING(255) },

            amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
            currency: { type: DataTypes.STRING(3), allowNull: false },

            status: {
                type: DataTypes.ENUM("INIT", "CAPTURED", "FAILED", "REFUNDED"),
                defaultValue: "INIT",
            },

            meta: { type: JSON_TYPE },
        },
        {
            tableName: "payment",
            underscored: true,
            freezeTableName: true,
            engine: "InnoDB",
            indexes: [
                { fields: ["stay_id"] },
            ],
        }
    );

    Payment.associate = (models) => {
        Payment.belongsTo(models.Stay, {
            foreignKey: "stay_id",
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
            constraints: true,
        });
    };

    return Payment;
};
