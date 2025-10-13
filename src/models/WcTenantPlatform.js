import { DataTypes } from "sequelize";
import { PLATFORM_STATUS } from "../constants/platforms.js";

export default (sequelize) => {
  const WcTenantPlatform = sequelize.define(
    "WcTenantPlatform",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      tenant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "wc_tenant", key: "id" },
      },
      platform_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "platform", key: "id" },
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: PLATFORM_STATUS[0],
        validate: { isIn: [PLATFORM_STATUS] },
      },
      username: {
        type: DataTypes.STRING(120),
        allowNull: true,
        validate: { len: [0, 120] },
      },
      password: {
        type: DataTypes.STRING(120),
        allowNull: true,
        validate: { len: [0, 120] },
      },
      notes: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      face_verification_url: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          len: [0, 255],
          isUrlOrEmpty(value) {
            if (!value) return
            const str = String(value).trim()
            if (!str) return
            try {
              new URL(str)
            } catch (err) {
              throw new Error("face_verification_url must be a valid URL")
            }
          },
        },
        set(val) {
          if (val == null) {
            this.setDataValue("face_verification_url", null)
            return
          }
          const str = String(val).trim()
          this.setDataValue("face_verification_url", str || null)
        },
      },
    },
    {
      tableName: "wc_tenant_platform",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { unique: true, fields: ["tenant_id", "platform_id"] },
        { fields: ["tenant_id"] },
        { fields: ["platform_id"] },
      ],
    }
  );

  WcTenantPlatform.associate = (models) => {
    if (models.WcTenant) {
      WcTenantPlatform.belongsTo(models.WcTenant, { foreignKey: "tenant_id", as: "tenant" });
    }
    if (models.Platform) {
      WcTenantPlatform.belongsTo(models.Platform, { foreignKey: "platform_id", as: "platform" });
    }
  };

  WcTenantPlatform.STATUS_VALUES = PLATFORM_STATUS;

  return WcTenantPlatform;
};
