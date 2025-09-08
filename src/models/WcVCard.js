import { DataTypes } from "sequelize";

export default (sequelize) => {
  const jsonType = sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

  const WcVCard = sequelize.define(
    "WcVCard",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "wc_tenant", key: "id" },
        onDelete: "CASCADE",
      },

      // Plain storage here for simplicity; consider at-rest encryption
      card_number: { type: DataTypes.STRING(32), allowNull: false },
      card_cvv: { type: DataTypes.STRING(8), allowNull: false },

      exp_month: {
        type: DataTypes.INTEGER,
        allowNull: false,
        set(value) {
          const m = Number(value);
          this.setDataValue("exp_month", m);
        },
        validate: {
          isInt: { msg: "exp_month debe ser entero" },
          min: { args: [1], msg: "exp_month mínimo 1" },
          max: { args: [12], msg: "exp_month máximo 12" },
        },
      },

      exp_year: {
        type: DataTypes.INTEGER,
        allowNull: false,
        set(value) {
          let y = Number(value);
          if (Number.isNaN(y)) throw new Error("exp_year inválido");
          // Permitir 2 dígitos (28 -> 2028)
          if (y < 100) y = 2000 + y;
          this.setDataValue("exp_year", y);
        },
        validate: {
          isInt: { msg: "exp_year debe ser entero" },
          minDynamic(value) {
            // Evitar años absurdos
            if (value < 2000) throw new Error("exp_year debe ser >= 2000");
          },
          notPast() {
            // Validar que la tarjeta no esté vencida (usa exp_month + exp_year)
            const m = this.getDataValue("exp_month");
            const y = this.getDataValue("exp_year");
            if (!m || !y) return;

            const now = new Date();
            const nowYM = now.getFullYear() * 100 + (now.getMonth() + 1);
            const cardYM = y * 100 + m;
            if (cardYM < nowYM) {
              throw new Error("La tarjeta ya está vencida");
            }
          },
          maxDynamic(value) {
            const limit = new Date().getFullYear() + 30; // margen razonable
            if (value > limit) {
              throw new Error(`exp_year demasiado en el futuro (${value})`);
            }
          },
        },
      },

      holder_name: { type: DataTypes.STRING(120), allowNull: true },

      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: true },
      currency: { type: DataTypes.STRING(3), allowNull: true },

      status: {
        type: DataTypes.ENUM("pending", "claimed", "delivered", "approved", "rejected"),
        allowNull: false,
        defaultValue: "pending",
      },

      claimed_by_account_id: { type: DataTypes.INTEGER, allowNull: true },
      claimed_at: { type: DataTypes.DATE, allowNull: true },
      delivered_at: { type: DataTypes.DATE, allowNull: true },
      delivered_by_account_id: { type: DataTypes.INTEGER, allowNull: true },
      approved_at: { type: DataTypes.DATE, allowNull: true },
      approved_by_account_id: { type: DataTypes.INTEGER, allowNull: true },

      metadata: { type: jsonType, allowNull: true, defaultValue: {} },
    },
    {
      tableName: "wc_vcard",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["tenant_id", "status"] },
        { fields: ["claimed_by_account_id", "status"] },
      ],
    }
  );

  WcVCard.associate = (models) => {
    if (models.WcTenant) WcVCard.belongsTo(models.WcTenant, { foreignKey: "tenant_id" });
  };

  return WcVCard;
};
