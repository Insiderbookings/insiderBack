import { DataTypes } from 'sequelize';

export default (sequelize) => {
    const ItineraryItem = sequelize.define('ItineraryItem', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        itinerary_day_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'itinerary_days',
                key: 'id',
            },
            onDelete: 'CASCADE',
        },
        time: {
            type: DataTypes.TIME,
            allowNull: true,
        },
        activity: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        icon: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'calendar',
        },
        location: {
            type: DataTypes.JSON, // { lat, lng, address, placeId }
            allowNull: true,
        },
        type: {
            type: DataTypes.ENUM('MANUAL', 'AI_SUGGESTION', 'BOOKING', 'FLIGHT'),
            defaultValue: 'MANUAL',
        },
        status: {
            type: DataTypes.ENUM('CONFIRMED', 'TENTATIVE', 'CANCELLED'),
            defaultValue: 'CONFIRMED',
        },
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'user', // Matches tableName in User.js
                key: 'id',
            },
        },
    }, {
        tableName: 'itinerary_items',
        timestamps: true,
        ordering: [['time', 'ASC']],
    });

    ItineraryItem.associate = (models) => {
        ItineraryItem.belongsTo(models.ItineraryDay, { foreignKey: 'itinerary_day_id', as: 'day' });
        if (models.User) {
            ItineraryItem.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
        }
    };

    return ItineraryItem;
};
