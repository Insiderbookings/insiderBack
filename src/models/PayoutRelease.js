import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQLFamily = ["mysql", "mariadb"].includes(sequelize.getDialect());
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const PayoutRelease = sequelize.define(
    "PayoutRelease",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      status: {
        type: DataTypes.ENUM("DRAFT", "APPROVED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"),
        allowNull: false,
        defaultValue: "DRAFT",
      },
      cutoff_date: { type: DataTypes.DATEONLY, allowNull: false },
      batch_limit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      preview_summary: { type: JSON_TYPE, allowNull: false },
      preview_snapshot: { type: JSON_TYPE, allowNull: false },
      snapshot_hash: { type: DataTypes.STRING(128), allowNull: false },
      prepared_by: { type: DataTypes.INTEGER, allowNull: false },
      approved_by: { type: DataTypes.INTEGER, allowNull: true },
      approved_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      executed_by: { type: DataTypes.INTEGER, allowNull: true },
      executed_at: { type: DataTypes.DATE, allowNull: true },
      payout_batch_id: { type: DataTypes.INTEGER, allowNull: true },
      run_result: { type: JSON_TYPE, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: "payout_release",
      underscored: true,
      freezeTableName: true,
      paranoid: false,
    }
  );

  PayoutRelease.associate = (models) => {
    PayoutRelease.belongsTo(models.PayoutBatch, { foreignKey: "payout_batch_id", as: "batch" });
  };

  return PayoutRelease;
};
