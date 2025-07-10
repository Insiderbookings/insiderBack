import { DataTypes } from "sequelize";

export default (sequelize) => {
  const Room = sequelize.define("Room", {
    id: {
      type         : DataTypes.INTEGER,
      primaryKey   : true,
      autoIncrement: true,
    },

    hotel_id: {
      type      : DataTypes.INTEGER,
      allowNull : false,
      references: { model: "Hotel", key: "id" },
    },

    /* ─────────── Campos que espera el front ─────────── */
    roomNumber : {
      type      : DataTypes.INTEGER,
      allowNull : false,
      unique    : true,    // opcional: si cada número de habitación debe ser único globalmente
      validate  : { min: 1 },
    },
    name       : DataTypes.STRING(120),
    description: DataTypes.TEXT,
    image      : DataTypes.STRING(255),
    price      : { type: DataTypes.DECIMAL(10,2), allowNull: false },   // antes pricePerNight
    capacity   : { type: DataTypes.INTEGER, allowNull: false },        // adultos + niños
    beds       : DataTypes.STRING(50),
    amenities  : { type: DataTypes.ARRAY(DataTypes.STRING), defaultValue: [] },
    available  : { type: DataTypes.INTEGER, defaultValue: 0 },
    suite      : {type: DataTypes.BOOLEAN, defaultValue: false}

  }, {
    underscored: true,
    timestamps : true,
    paranoid   : true,
  });

  Room.associate = (models) => {
    Room.belongsTo(models.Hotel,   { foreignKey: "hotel_id" });
    Room.hasMany  (models.Booking, { foreignKey: "room_id" });
  };

  return Room;
};
