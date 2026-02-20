import { DataTypes } from "sequelize";

export default (sequelize) => {
  const ScheduledJobRun = sequelize.define(
    "ScheduledJobRun",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      jobName: {
        type: DataTypes.STRING(120),
        field: "job_name",
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING(80),
        allowNull: false,
        defaultValue: "manual",
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "RUNNING",
      },
      startedAt: {
        type: DataTypes.DATE,
        field: "started_at",
        allowNull: false,
      },
      finishedAt: {
        type: DataTypes.DATE,
        field: "finished_at",
        allowNull: true,
      },
      triggeredBy: {
        type: DataTypes.INTEGER,
        field: "triggered_by",
        allowNull: true,
      },
      errorMessage: {
        type: DataTypes.TEXT,
        field: "error_message",
        allowNull: true,
      },
    },
    {
      tableName: "scheduled_job_runs",
      freezeTableName: true,
      underscored: true,
    }
  );

  return ScheduledJobRun;
};

