import { DataTypes } from "sequelize";

export default (sequelize) => {
    const jsonType =
        sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

    const WcAccount = sequelize.define(
        "WcAccount",
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

            tenant_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "wc_tenant", key: "id" },
                onDelete: "CASCADE",
            },

            email: {
                type: DataTypes.STRING(160),
                allowNull: false,
                validate: { isEmail: true },
            },

            display_name: { type: DataTypes.STRING(120), allowNull: true },

            password_hash: {
                type: DataTypes.STRING(200),
                allowNull: false, // la auth del panel es local
            },

            is_active: { type: DataTypes.BOOLEAN, defaultValue: true },

            /* Roles/permisos específicos de este constructor */
            roles: { type: jsonType, allowNull: false, defaultValue: [] },
            permissions: { type: jsonType, allowNull: false, defaultValue: [] },
        },
        {
            tableName: "wc_account",
            freezeTableName: true,
            underscored: true,
            paranoid: true,
            indexes: [
                // evita duplicar email por tenant (multi-tenant real)
                {
                    name: "wc_account_email_tenant_unique",
                    unique: true,
                    fields: ["tenant_id", "email"],
                },
            ],
        }
    );

    WcAccount.associate = (models) => {
        WcAccount.belongsTo(models.WcTenant, { foreignKey: "tenant_id" });
    };

    return WcAccount;
};
