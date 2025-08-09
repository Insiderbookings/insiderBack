    // src/models/OutsideMeta.js
    import { DataTypes } from "sequelize";

    export default (sequelize) => {
    const OutsideMeta = sequelize.define(
        "OutsideMeta",
        {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

        /* ——— FK a Booking ——— */
        booking_id: {
            type       : DataTypes.INTEGER,
            allowNull  : false,
            references : { model: "booking", key: "id" },
            onDelete   : "CASCADE",
        },

        /* ——— Datos propios de una reserva externa ——— */
        confirmation_token: DataTypes.STRING,   // token enviado al huésped
        confirmed_at     : DataTypes.DATE,
        staff_user_id    : {
            type       : DataTypes.INTEGER,
            allowNull  : true,
            references : { model: "user", key: "id" }, // quién la cargó
            onDelete   : "SET NULL",
        },
        room_number      : DataTypes.STRING,     // p. ej. "1205"
        notes            : DataTypes.JSONB,      // cualquier dato libre

        /* ——— Campo libre ——— */
        meta: DataTypes.JSONB,
        },
        {
        tableName      : "outside_meta",
        underscored    : true,
        freezeTableName: true,
        }
    );

    /* ——— Asociaciones ——— */
    OutsideMeta.associate = (models) => {
        OutsideMeta.belongsTo(models.Booking, { foreignKey: "booking_id" });
        OutsideMeta.belongsTo(models.User,    { foreignKey: "staff_user_id", as: "staffUser" });
    };

    return OutsideMeta;
    };
