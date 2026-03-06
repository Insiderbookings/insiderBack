import { DataTypes } from "sequelize";

const STATUS_VALUES = ["PENDING", "SENT"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const isMySQLFamily = ["mysql", "mariadb"].includes(dialect);
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const ReviewReminderLog = sequelize.define(
    "ReviewReminderLog",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      booking_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "booking", key: "id" },
        onDelete: "CASCADE",
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "user", key: "id" },
        onDelete: "CASCADE",
      },
      reminder_key: {
        type: DataTypes.STRING(80),
        allowNull: false,
      },
      channel: {
        type: DataTypes.STRING(24),
        allowNull: false,
        defaultValue: "PUSH",
      },
      inventory_type: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      inventory_id: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...STATUS_VALUES),
        allowNull: false,
        defaultValue: "PENDING",
      },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      payload: {
        type: JSON_TYPE,
        allowNull: true,
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "review_reminder_log",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          name: "review_reminder_log_unique_delivery",
          unique: true,
          fields: ["booking_id", "user_id", "reminder_key", "channel"],
        },
        { fields: ["status"] },
        { fields: ["sent_at"] },
      ],
    }
  );

  ReviewReminderLog.associate = (models) => {
    if (models.Stay) {
      ReviewReminderLog.belongsTo(models.Stay, { foreignKey: "booking_id", as: "booking" });
    }
    if (models.User) {
      ReviewReminderLog.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  };

  return ReviewReminderLog;
};
