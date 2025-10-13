import { DataTypes } from "sequelize";
import { PLATFORM_DEFAULTS, PLATFORM_STATUS } from "../constants/platforms.js";

export default (sequelize) => {
  const Platform = sequelize.define(
    "Platform",
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        unique: true,
        validate: { len: [2, 120] },
      },
      slug: {
        type: DataTypes.STRING(80),
        allowNull: false,
        unique: true,
        validate: { len: [2, 80] },
      },
      requiresFaceVerification: {
        type: DataTypes.BOOLEAN,
        field: "requires_face_verification",
        allowNull: false,
        defaultValue: false,
      },
      description: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
    },
    {
      tableName: "platform",
      freezeTableName: true,
      underscored: true,
      paranoid: true,
      indexes: [
        { unique: true, fields: ["slug"] },
        { fields: ["requires_face_verification"] },
      ],
    }
  );

  Platform.associate = (models) => {
    if (models.WcTenantPlatform) {
      Platform.hasMany(models.WcTenantPlatform, {
        foreignKey: "platform_id",
        as: "tenantLinks",
      });
    }
  };

  Platform.STATUS_VALUES = PLATFORM_STATUS;
  Platform.DEFAULTS = PLATFORM_DEFAULTS;

  return Platform;
};
