import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Hotel = sequelize.define(
    "Hotel",
    {
      id         : { 
        type: DataTypes.INTEGER, 
        primaryKey: true, 
        autoIncrement: true 
      },
      name       : { 
        type: DataTypes.STRING(120), 
        allowNull: false 
      },
      location   : { 
        type: DataTypes.STRING(120) 
      },
      description: DataTypes.TEXT,
      image      : DataTypes.STRING(255),
      phone      : { 
        type: DataTypes.STRING(20) 
      },
      rating     : { 
        type: DataTypes.DECIMAL(2, 1), 
        defaultValue: 0 
      },
      price      : { 
        type: DataTypes.DECIMAL(10, 2) 
      },
      category   : DataTypes.STRING(60),
      amenities  : { 
        type: DataTypes.JSONB, 
        defaultValue: {} 
      },
      lat        : { 
        type: DataTypes.DECIMAL(9, 6) 
      },
      lng        : { 
        type: DataTypes.DECIMAL(9, 6) 
      },
      starRating : { 
        type: DataTypes.INTEGER, 
        validate: { min: 1, max: 5 } 
      },
      address    : DataTypes.STRING(255),
      city       : DataTypes.STRING(100),
      country    : DataTypes.STRING(100),
    },
    {
      tableName       : "Hotel",
      freezeTableName : true,   // evita que Sequelize vuelva a pluralizar
      underscored     : true,   // usa created_at / updated_at
    }
  );

  Hotel.associate = (models) => {
    Hotel.hasMany(models.Room,         { foreignKey: "hotel_id" });
    Hotel.hasMany(models.Booking,      { foreignKey: "hotel_id" });
    Hotel.hasMany(models.DiscountCode, { foreignKey: "hotel_id" });
    Hotel.belongsToMany(models.Staff,  { 
      through: models.HotelStaff, 
      as: "staff", 
      foreignKey: "hotel_id" 
    });
  };

  return Hotel;
};
