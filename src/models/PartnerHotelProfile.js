import { DataTypes } from "sequelize";

export default (sequelize) => {
  const PartnerHotelProfile = sequelize.define(
    "PartnerHotelProfile",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      hotel_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      claim_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "DRAFT",
      },
      updated_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      headline: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      description_override: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      contact_name: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      contact_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      contact_phone: {
        type: DataTypes.STRING(40),
        allowNull: true,
      },
      website: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      response_time_badge_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      response_time_badge_label: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      special_offers_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      special_offers_title: {
        type: DataTypes.STRING(160),
        allowNull: true,
      },
      special_offers_body: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      profile_completion: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      published_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "partner_hotel_profile",
      freezeTableName: true,
      underscored: true,
      indexes: [
        {
          name: "uq_partner_hotel_profile_hotel",
          unique: true,
          fields: ["hotel_id"],
        },
        {
          name: "uq_partner_hotel_profile_claim",
          unique: true,
          fields: ["claim_id"],
        },
        {
          name: "idx_partner_hotel_profile_status",
          fields: ["status"],
        },
        {
          name: "idx_partner_hotel_profile_updated_by_user",
          fields: ["updated_by_user_id"],
        },
      ],
    },
  );

  PartnerHotelProfile.associate = (models) => {
    PartnerHotelProfile.belongsTo(models.WebbedsHotel, {
      foreignKey: "hotel_id",
      targetKey: "hotel_id",
      as: "hotel",
    });
    PartnerHotelProfile.belongsTo(models.PartnerHotelClaim, {
      foreignKey: "claim_id",
      as: "claim",
    });
    PartnerHotelProfile.belongsTo(models.User, {
      foreignKey: "updated_by_user_id",
      as: "updatedByUser",
    });
    if (models.PartnerHotelProfileImage) {
      PartnerHotelProfile.hasMany(models.PartnerHotelProfileImage, {
        foreignKey: "partner_hotel_profile_id",
        as: "profileImages",
        onDelete: "CASCADE",
      });
    }
    if (models.PartnerHotelProfileAmenity) {
      PartnerHotelProfile.hasMany(models.PartnerHotelProfileAmenity, {
        foreignKey: "partner_hotel_profile_id",
        as: "profileAmenities",
        onDelete: "CASCADE",
      });
    }
  };

  return PartnerHotelProfile;
};
