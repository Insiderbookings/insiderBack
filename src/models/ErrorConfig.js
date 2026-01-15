import { DataTypes, Model } from 'sequelize';

export default (sequelize) => {
    class ErrorConfig extends Model {
        static associate(models) {
            // No associations needed for now
        }
    }

    ErrorConfig.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        enableEmailAlerts: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        alertEmails: {
            type: DataTypes.TEXT, // Stored as comma-separated string or JSON
            defaultValue: '',
            get() {
                const rawValue = this.getDataValue('alertEmails');
                return rawValue ? rawValue.split(',').map(e => e.trim()) : [];
            },
            set(val) {
                if (Array.isArray(val)) {
                    this.setDataValue('alertEmails', val.join(','));
                } else {
                    this.setDataValue('alertEmails', val);
                }
            },
        },
        alertOnStatusCodes: {
            type: DataTypes.JSON, // Array of status codes, e.g. [500, 503]
            defaultValue: [500],
        },
        minIntervalMinutes: {
            type: DataTypes.INTEGER,
            defaultValue: 15, // Minimum time between duplicate alerts
        },
    }, {
        sequelize,
        modelName: 'ErrorConfig',
        tableName: 'error_configs',
        timestamps: true,
    });

    return ErrorConfig;
};
