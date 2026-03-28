import { DataTypes } from "sequelize";

const STATUS_VALUES = ["PENDING", "SENT"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const isMySqlFamily = ["mysql", "mariadb"].includes(dialect);
  const JSON_TYPE = isMySqlFamily ? DataTypes.JSON : DataTypes.JSONB;

  const BookingAbandonmentReminderLog = sequelize.define(
    "BookingAbandonmentReminderLog",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      flow_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "booking_flows", key: "id" },
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
      tableName: "booking_abandonment_reminder_log",
      underscored: true,
      freezeTableName: true,
      indexes: [
        {
          name: "booking_abandonment_reminder_unique_delivery",
          unique: true,
          fields: ["flow_id", "user_id", "reminder_key", "channel"],
        },
        { fields: ["status"] },
        { fields: ["sent_at"] },
      ],
    },
  );

  BookingAbandonmentReminderLog.associate = (models) => {
    if (models.BookingFlow) {
      BookingAbandonmentReminderLog.belongsTo(models.BookingFlow, {
        foreignKey: "flow_id",
        as: "flow",
      });
    }
    if (models.User) {
      BookingAbandonmentReminderLog.belongsTo(models.User, {
        foreignKey: "user_id",
        as: "user",
      });
    }
  };

  return BookingAbandonmentReminderLog;
};
