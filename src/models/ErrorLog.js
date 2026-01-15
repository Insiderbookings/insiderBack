import { DataTypes, Model } from 'sequelize';

export default (sequelize) => {
    class ErrorLog extends Model {
        static associate(models) {
            ErrorLog.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
        }
    }

    ErrorLog.init({
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        level: {
            type: DataTypes.STRING,
            defaultValue: 'error', // error, warn, info
        },
        statusCode: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        method: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        path: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        stack: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        ip: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    }, {
        sequelize,
        modelName: 'ErrorLog',
        tableName: 'error_logs',
        timestamps: true,
    });

    return ErrorLog;
};
