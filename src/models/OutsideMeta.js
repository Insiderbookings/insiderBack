// src/models/OutsideMeta.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
    const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
    const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

    const OutsideMeta = sequelize.define(
        "OutsideMeta",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            // dejo el tipo pero sin references; la FK la agrega la asociación
            booking_id: { type: DataTypes.INTEGER, allowNull: false },

            confirmation_token: { type: DataTypes.STRING },
            confirmed_at: { type: DataTypes.DATE },

            staff_user_id: { type: DataTypes.INTEGER, allowNull: true },
            room_number: { type: DataTypes.STRING },

            // JSONB en PG, JSON en MySQL/MariaDB (sin defaultValue)
            notes: { type: JSON_TYPE },
            meta: { type: JSON_TYPE },
        },
        {
            tableName: "outside_meta",
            underscored: true,
            freezeTableName: true,
            engine: "InnoDB",
            indexes: [{ fields: ["booking_id"] }, { fields: ["staff_user_id"] }],
        }
    );

    OutsideMeta.associate = (models) => {
        OutsideMeta.belongsTo(models.Booking, {
            foreignKey: "booking_id",
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
            constraints: true,
        });
        OutsideMeta.belongsTo(models.User, {
            foreignKey: "staff_user_id",
            as: "staffUser",
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
            constraints: true,
        });
    };

    return OutsideMeta;
};
