// src/models/OutsideMeta.js
import { DataTypes } from "sequelize";

export default (sequelize) => {
    const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
    const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

    const OutsideMeta = sequelize.define(
        "OutsideMeta",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            stay_id: { type: DataTypes.INTEGER, allowNull: true },
            booking_id: { type: DataTypes.INTEGER, allowNull: true },

            confirmation_token: { type: DataTypes.STRING },
            confirmed_at: { type: DataTypes.DATE },

            staff_user_id: { type: DataTypes.INTEGER, allowNull: true },
            room_number: { type: DataTypes.STRING },

            notes: { type: JSON_TYPE },
            meta: { type: JSON_TYPE },
        },
        {
            tableName: "outside_meta",
            underscored: true,
            freezeTableName: true,
            engine: "InnoDB",
            indexes: [
                { fields: ["stay_id"] },
                { fields: ["booking_id"] },
                { fields: ["staff_user_id"] },
            ],
        }
    );

    OutsideMeta.addHook("beforeSave", (instance) => {
        if (instance.stay_id == null && instance.booking_id != null) instance.stay_id = instance.booking_id;
        if (instance.booking_id == null && instance.stay_id != null) instance.booking_id = instance.stay_id;
    });

    OutsideMeta.associate = (models) => {
        OutsideMeta.belongsTo(models.Stay, {
            foreignKey: "stay_id",
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
