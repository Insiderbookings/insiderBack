// src/models/Stay.js
import { DataTypes } from "sequelize";

const SOURCE_ENUM = ["PARTNER", "OUTSIDE", "VAULT", "HOME"];
const INVENTORY_ENUM = ["WEBBEDS_HOTEL", "LOCAL_HOTEL", "HOME", "MANUAL_HOTEL"];
const STATUS_ENUM = ["DRAFT", "PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];
const PAYMENT_STATUS_ENUM = ["UNPAID", "PENDING", "PAID", "REFUNDED"];
const PRIVACY_ENUM = ["ENTIRE_PLACE", "PRIVATE_ROOM", "SHARED_ROOM"];
const PUBLISH_STATE_ENUM = ["DRAFT", "REVIEW", "PUBLISHED", "SUSPENDED"];

export default (sequelize) => {
  const dialect = sequelize.getDialect();
  const isMySQLFamily = ["mysql", "mariadb"].includes(dialect);
  const JSON_TYPE = isMySQLFamily ? DataTypes.JSON : DataTypes.JSONB;

  const Stay = sequelize.define(
    "Stay",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      booking_ref: { type: DataTypes.STRING(40), unique: true, allowNull: true },
      reference: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.getDataValue("booking_ref");
        },
        set(value) {
          this.setDataValue("booking_ref", value);
        },
      },

      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
      },
      influencer_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "user", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      inventory_type: {
        type: DataTypes.ENUM(...INVENTORY_ENUM),
        allowNull: false,
        // Default to provider-backed hotel inventory; keep LOCAL_HOTEL for legacy compatibility.
        defaultValue: "WEBBEDS_HOTEL",
      },
      inventory_id: { type: DataTypes.STRING(80), allowNull: true },

      source: {
        type: DataTypes.ENUM(...SOURCE_ENUM),
        allowNull: false,
      },

      external_ref: { type: DataTypes.STRING(120) },

      check_in: { type: DataTypes.DATEONLY, allowNull: false },
      check_out: { type: DataTypes.DATEONLY, allowNull: false },
      nights: { type: DataTypes.INTEGER, allowNull: true },

      adults: { type: DataTypes.INTEGER, allowNull: false },
      children: { type: DataTypes.INTEGER, defaultValue: 0 },

      guest_name: { type: DataTypes.STRING(120), allowNull: false },
      guest_email: {
        type: DataTypes.STRING(150),
        allowNull: false,
        validate: { isEmail: true },
      },
      guest_phone: { type: DataTypes.STRING(50) },

      flow_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "booking_flows", key: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
      },

      outside: { type: DataTypes.BOOLEAN, defaultValue: false },
      active: { type: DataTypes.BOOLEAN, defaultValue: true },

      privacy_level: {
        type: DataTypes.ENUM(...PRIVACY_ENUM),
        allowNull: true,
      },

      status: {
        type: DataTypes.ENUM(...STATUS_ENUM),
        defaultValue: "PENDING",
      },
      publish_state: {
        type: DataTypes.ENUM(...PUBLISH_STATE_ENUM),
        allowNull: true,
      },
      payment_status: {
        type: DataTypes.ENUM(...PAYMENT_STATUS_ENUM),
        defaultValue: "UNPAID",
      },

      gross_price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      net_cost: { type: DataTypes.DECIMAL(10, 2) },
      currency: { type: DataTypes.STRING(3), allowNull: false },

      fees_total: { type: DataTypes.DECIMAL(10, 2) },
      taxes_total: { type: DataTypes.DECIMAL(10, 2) },

      payment_provider: {
        type: DataTypes.ENUM("STRIPE", "PAYPAL", "CARD_ON_FILE", "NONE"),
        defaultValue: "STRIPE",
      },
      payment_intent_id: { type: DataTypes.STRING(100) },

      booked_at: { type: DataTypes.DATE },
      cancelled_at: { type: DataTypes.DATE },
      rate_expires_at: { type: DataTypes.DATE },

      pricing_snapshot: { type: JSON_TYPE },
      guest_snapshot: { type: JSON_TYPE },
      inventory_snapshot: { type: JSON_TYPE },
      meta: { type: JSON_TYPE },
    },
    {
      tableName: "booking",
      underscored: true,
      freezeTableName: true,
      defaultScope: {
        // Prevent selecting legacy hotel_id fields removed from the schema
        attributes: { exclude: ["hotel_id", "room_id"] },
      },
      indexes: [
        { fields: ["booking_ref"], unique: true },
        { fields: ["user_id"] },
        { fields: ["influencer_user_id"] },
        { fields: ["status"] },
        { fields: ["payment_status"] },
        { fields: ["source", "external_ref"] },
        { fields: ["inventory_type", "inventory_id"] },
        { fields: ["flow_id"] },
      ],
    }
  );

  Stay.associate = (models) => {
    Stay.belongsTo(models.User, { foreignKey: "user_id" });
    Stay.belongsTo(models.User, { foreignKey: "influencer_user_id", as: "influencer" });
    if (models.BookingFlow) {
      Stay.belongsTo(models.BookingFlow, { foreignKey: "flow_id", as: "flow" });
    }
    Stay.hasOne(models.Payment, { foreignKey: "stay_id" });
    Stay.hasOne(models.StayHotel, { foreignKey: "stay_id", as: "hotelStay" });
    Stay.hasOne(models.StayHome, { foreignKey: "stay_id", as: "homeStay" });
    Stay.hasOne(models.StayManual, { foreignKey: "stay_id", as: "manualStay" });
    if (models.OutsideMeta) {
      Stay.hasOne(models.OutsideMeta, { foreignKey: "stay_id", as: "outsideMeta" });
    }

    Stay.belongsToMany(models.AddOn, {
      through: models.BookingAddOn,
      foreignKey: "stay_id",
      otherKey: "add_on_id",
    });
    Stay.hasMany(models.BookingAddOn, { foreignKey: "stay_id" });
    Stay.hasOne(models.DiscountCode, { foreignKey: "stay_id" });

    if (models.Commission) {
      Stay.hasOne(models.Commission, { foreignKey: "stay_id" });
    }
    if (models.StayIntelligence) {
      Stay.hasOne(models.StayIntelligence, { foreignKey: "stay_id", as: "intelligence" });
    }
    if (models.BookingUser) {
      Stay.hasMany(models.BookingUser, { foreignKey: "stay_id", as: "members" });
    }
  };

  return Stay;
};
