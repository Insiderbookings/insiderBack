import { DataTypes } from "sequelize";

export default (sequelize) => {
    const isMySQL = ["mysql", "mariadb"].includes(sequelize.getDialect());
    const JSON_TYPE = isMySQL ? DataTypes.JSON : DataTypes.JSONB;

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
                type: JSON_TYPE,
                defaultValue: [],
            },
            preparation: {
                type: JSON_TYPE,
                defaultValue: [],
            },
            weatherTips: {
                type: JSON_TYPE,
                defaultValue: null,
            },
            lastGeneratedAt: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW,
            },
            metadata: {
                type: JSON_TYPE,
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
