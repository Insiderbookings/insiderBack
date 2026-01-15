import { DataTypes } from 'sequelize';

export default (sequelize) => {
    const ItineraryDay = sequelize.define('ItineraryDay', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        booking_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'booking', // Matches tableName in Stay.js
                key: 'id',
            },
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        title: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'Day Plan',
        },
        metadata: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: {},
        },
    }, {
        tableName: 'itinerary_days',
        timestamps: true,
        indexes: [
            {
                fields: ['booking_id', 'date'],
                unique: true,
            },
        ],
    });

    ItineraryDay.associate = (models) => {
        // Assuming 'Booking' model exists (it is an alias for Stay in index.js)
        if (models.Booking) {
            ItineraryDay.belongsTo(models.Booking, { foreignKey: 'booking_id', as: 'booking' });
        }
        ItineraryDay.hasMany(models.ItineraryItem, { foreignKey: 'itinerary_day_id', as: 'items' });
    };

    return ItineraryDay;
};
