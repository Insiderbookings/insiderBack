import { DataTypes } from "sequelize";

const STEP_VALUES = [
  "GETROOMS",
  "BLOCK",
  "SAVEBOOKING",
  "BOOK_NO",
  "PREAUTH",
  "BOOK_YES",
  "CANCEL_NO",
  "CANCEL_YES",
  "RECHECK",
];

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql" || sequelize.getDialect() === "mariadb";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const BookingFlowStep = sequelize.define(
    "BookingFlowStep",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      flow_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      step: {
        type: DataTypes.ENUM(...STEP_VALUES),
        allowNull: false,
      },
      command: { type: DataTypes.STRING(60) },
      tid: { type: DataTypes.STRING(120) },
      success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      error_class: { type: DataTypes.STRING(120) },
      error_code: { type: DataTypes.STRING(60) },
      allocation_in: { type: DataTypes.TEXT },
      allocation_out: { type: DataTypes.TEXT },
      booking_code_out: { type: DataTypes.TEXT },
      service_ref_out: { type: DataTypes.TEXT },
      order_code_out: { type: DataTypes.TEXT },
      authorisation_out: { type: DataTypes.TEXT },
      prices_out: { type: JSON_TYPE },
      within_cancellation_deadline_out: { type: DataTypes.BOOLEAN },
      request_xml: { type: DataTypes.TEXT },
      response_xml: { type: DataTypes.TEXT },
      idempotency_key: { type: DataTypes.STRING(120) },
    },
    {
      tableName: "booking_flow_steps",
      freezeTableName: true,
      underscored: true,
      paranoid: false,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["flow_id"] },
        { fields: ["flow_id", "step"] },
        { unique: true, fields: ["flow_id", "step", "idempotency_key"] },
      ],
    },
  );

  BookingFlowStep.associate = (models) => {
    BookingFlowStep.belongsTo(models.BookingFlow, {
      foreignKey: "flow_id",
      as: "flow",
    });
  };

  return BookingFlowStep;
};
