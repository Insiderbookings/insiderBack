import { DataTypes } from "sequelize";

export default (sequelize) => {
  const ScheduledJob = sequelize.define(
    "ScheduledJob",
    {
      name: {
        type: DataTypes.STRING(120),
        primaryKey: true,
        allowNull: false,
        unique: true,
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      cronExpression: {
        type: DataTypes.STRING(120),
        field: "cron_expression",
        allowNull: true,
      },
      timezone: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      lastRunAt: {
        type: DataTypes.DATE,
        field: "last_run_at",
        allowNull: true,
      },
      lastStatus: {
        type: DataTypes.STRING(32),
        field: "last_status",
        allowNull: true,
      },
      lastError: {
        type: DataTypes.TEXT,
        field: "last_error",
        allowNull: true,
      },
      nextRunAt: {
        type: DataTypes.DATE,
        field: "next_run_at",
        allowNull: true,
      },
      updatedBy: {
        type: DataTypes.INTEGER,
        field: "updated_by",
        allowNull: true,
      },
    },
    {
      tableName: "scheduled_jobs",
      freezeTableName: true,
      underscored: true,
    }
  );

  return ScheduledJob;
};
