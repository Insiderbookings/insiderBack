import { DataTypes } from "sequelize";

const STATUS_VALUES = [
  "STARTED",
  "OFFER_SELECTED",
  "BLOCKED",
  "SAVED",
  "PRICED",
  "PREAUTHED",
  "CONFIRMED",
  "CANCEL_QUOTED",
  "CANCELLED",
  "FAILED",
];

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql" || sequelize.getDialect() === "mariadb";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const BookingFlow = sequelize.define(
    "BookingFlow",
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
      },
      status: {
        type: DataTypes.ENUM(...STATUS_VALUES),
        allowNull: false,
        defaultValue: "STARTED",
      },
      status_reason: { type: DataTypes.STRING(255) },

      search_context: { type: JSON_TYPE },
      selected_offer: { type: JSON_TYPE },

      allocation_current: { type: DataTypes.TEXT },
      itinerary_booking_code: { type: DataTypes.TEXT },
      service_reference_number: { type: DataTypes.TEXT },
      supplier_order_code: { type: DataTypes.TEXT },
      supplier_authorisation_id: { type: DataTypes.TEXT },
      final_booking_code: { type: DataTypes.TEXT },
      booking_reference_number: { type: DataTypes.TEXT },

      pricing_snapshot_priced: { type: JSON_TYPE },
      pricing_snapshot_preauth: { type: JSON_TYPE },
      pricing_snapshot_confirmed: { type: JSON_TYPE },
      cancel_quote_snapshot: { type: JSON_TYPE },
      cancel_result_snapshot: { type: JSON_TYPE },
    },
    {
      tableName: "booking_flows",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
    },
  );

  BookingFlow.associate = (models) => {
    BookingFlow.hasMany(models.BookingFlowStep, {
      foreignKey: "flow_id",
      as: "steps",
    });
  };

  return BookingFlow;
};
