import sequelize from "../config/database.js";

import UserModel         from "./User.js";
import StaffRoleModel    from "./StaffRole.js";
import StaffModel        from "./Staff.js";
import HotelModel        from "./Hotel.js";
import RoomModel         from "./Room.js";
import DiscountCodeModel from "./DiscountCode.js";
import BookingModel      from "./Booking.js";
import CommissionModel   from "./Commission.js";
import AddOnModel        from "./AddOn.js";
import BookingAddOnModel from "./BookingAddOn.js";
import MessageModel      from "./Message.js";
import UpsellCodeModel   from "./UpsellCode.js";
import HotelStaffModel   from "./HotelStaff.js"

const models = {};

models.User         = UserModel(sequelize);
models.StaffRole    = StaffRoleModel(sequelize);
models.Staff        = StaffModel(sequelize);
models.Hotel        = HotelModel(sequelize);
models.Room         = RoomModel(sequelize);
models.DiscountCode = DiscountCodeModel(sequelize);
models.Booking      = BookingModel(sequelize);
models.Commission   = CommissionModel(sequelize);
models.AddOn        = AddOnModel(sequelize);
models.BookingAddOn = BookingAddOnModel(sequelize);
models.Message      = MessageModel(sequelize);
models.UpsellCode    = UpsellCodeModel(sequelize);
models.HotelStaff   = HotelStaffModel(sequelize);

// Ejecutar asociaciones
Object.values(models)
  .filter((m) => typeof m.associate === "function")
  .forEach((m) => m.associate(models));

export { sequelize };
export default models;
