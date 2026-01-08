import { DataTypes } from "sequelize";

export default (sequelize) => {
    const StayIntelligence = sequelize.define(
        "StayIntelligence",
        {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true,
            },
            stayId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
            },
            insights: {
                type: DataTypes.JSONB,
                defaultValue: [],
            },
            preparation: {
                type: DataTypes.JSONB,
                defaultValue: [],
            },
            weatherTips: {
                type: DataTypes.JSONB,
                defaultValue: null,
            },
            lastGeneratedAt: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
            metadata: {
                type: DataTypes.JSONB,
                defaultValue: {},
            },
        },
        {
            tableName: "stay_intelligences",
            timestamps: true,
            underscored: true,
        }
    );

    StayIntelligence.associate = (models) => {
        StayIntelligence.belongsTo(models.Stay, {
            foreignKey: "stayId",
            as: "stay",
            onDelete: "CASCADE",
        });
    };

    return StayIntelligence;
};
