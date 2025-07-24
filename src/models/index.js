import sequelize from "../config/database.js";

/* ---------- Importar modelos ---------- */
import UserModel           from "./User.js";
import StaffRoleModel      from "./StaffRole.js";
import StaffModel          from "./Staff.js";
import HotelModel          from "./Hotel.js";
import HotelImageModel     from "./HotelImage.js";
import RoomModel           from "./Room.js";
import DiscountCodeModel   from "./DiscountCode.js";
import BookingModel        from "./Booking.js";
import CommissionModel     from "./Commission.js";
import AddOnModel          from "./AddOn.js";
import BookingAddOnModel   from "./BookingAddOn.js";
import MessageModel        from "./Message.js";
import UpsellCodeModel     from "./UpsellCode.js";
import HotelStaffModel     from "./HotelStaff.js";
import OutsideBooking from "./OutsideBooking.js";
import OutsideBookingAddOn from "./OutsideBookingAddOn.js";
import AddOnOption from "./AddonOption.js";
import HotelAddOn from "./HotelAddOn.js";
import HotelAddOnOption from "./HotelAddOnOption.js";
import HotelStaffAddOn from "./HotelStaffAddOn.js";
/* ---------- Construir objetos ---------- */
const models = {};

models.User           = UserModel(sequelize);
models.StaffRole      = StaffRoleModel(sequelize);
models.Staff          = StaffModel(sequelize);
models.Hotel          = HotelModel(sequelize);
models.HotelImage     = HotelImageModel(sequelize);
models.Room           = RoomModel(sequelize);
models.DiscountCode   = DiscountCodeModel(sequelize);
models.Booking        = BookingModel(sequelize);
models.Commission     = CommissionModel(sequelize);
models.AddOn          = AddOnModel(sequelize);
models.BookingAddOn   = BookingAddOnModel(sequelize);
models.Message        = MessageModel(sequelize);
models.UpsellCode     = UpsellCodeModel(sequelize);
models.HotelStaff     = HotelStaffModel(sequelize);
models.OutsideBooking = OutsideBooking(sequelize);
models.OutsideBookingAddOn = OutsideBookingAddOn(sequelize);
models.AddOnOption = AddOnOption(sequelize)
models.HotelAddOn = HotelAddOn(sequelize);
models.HotelAddOnOption = HotelAddOnOption(sequelize)
models.HotelStaffAddOn = HotelStaffAddOn(sequelize)
/* ---------- Ejecutar asociaciones ---------- */
Object.values(models)
  .filter((m) => typeof m.associate === "function")
  .forEach((m) => m.associate(models));

export { sequelize };
export default models;
