import { DataTypes } from "sequelize";

export default (sequelize) => {
  const jsonType = sequelize.getDialect() === "mysql" ? DataTypes.JSON : DataTypes.JSONB;

  const WcOperatorTransfer = sequelize.define(
    "WcOperatorTransfer",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "wc_tenant", key: "id" },
        onDelete: "CASCADE",
      },
      operator_account_id: { type: DataTypes.INTEGER, allowNull: true },
      assigned_account_id: { type: DataTypes.INTEGER, allowNull: true },
      status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pending" },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
      booking_code: { type: DataTypes.STRING(64), allowNull: false },
      guest_name: { type: DataTypes.STRING(160), allowNull: false },
      reference: { type: DataTypes.STRING(160), allowNull: true },
      notes: { type: DataTypes.STRING(255), allowNull: true },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      claimed_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: jsonType, allowNull: true, defaultValue: {} },
    },
    {
      tableName: "wc_operator_transfer",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { fields: ["tenant_id"] },
        { fields: ["operator_account_id"] },
        { fields: ["assigned_account_id"] },
        { fields: ["tenant_id", "status"] },
        { fields: ["tenant_id", "paid_at"] },
      ],
    }
  );

  WcOperatorTransfer.associate = (models) => {
    if (models.WcTenant) WcOperatorTransfer.belongsTo(models.WcTenant, { foreignKey: "tenant_id" });
  };

  return WcOperatorTransfer;
};
