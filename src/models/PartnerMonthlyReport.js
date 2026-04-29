import { DataTypes } from "sequelize";

export default (sequelize) => {
  const isMySQL = sequelize.getDialect() === "mysql";
  const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

  const PartnerMonthlyReport = sequelize.define(
    "PartnerMonthlyReport",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      claim_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      report_month: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      delivery_status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "PENDING",
      },
      generated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      sent_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      delivered_to_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      delivery_error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      last_downloaded_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      metrics: {
        type: JSON_TYPE,
        allowNull: false,
      },
      summary: {
        type: JSON_TYPE,
        allowNull: true,
      },
      meta: {
        type: JSON_TYPE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_monthly_report",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "uq_partner_monthly_report_claim_month",
          unique: true,
          fields: ["claim_id", "report_month"],
        },
        {
          name: "idx_partner_monthly_report_hotel_month",
          fields: ["hotel_id", "report_month"],
        },
        {
          name: "idx_partner_monthly_report_delivery_status",
          fields: ["delivery_status"],
        },
      ],
    },
  );

  PartnerMonthlyReport.associate = (models) => {
    PartnerMonthlyReport.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerMonthlyReport.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
  };

  return PartnerMonthlyReport;
};
