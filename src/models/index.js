// src/models/index.js
import sequelize from "../config/database.js"

/* ---------- Importar modelos ---------- */
import UserModel            from "./User.js"
import StaffRoleModel       from "./StaffRole.js"
import StaffModel           from "./Staff.js"
import HotelModel           from "./Hotel.js"
import HotelImageModel      from "./HotelImage.js"
import RoomModel            from "./Room.js"               // o RoomType.js si lo renombraste
import DiscountCodeModel    from "./DiscountCode.js"
import BookingModel         from "./Booking.js"
import PaymentModel         from "./Payment.js"            // 1-a-1 con Booking
import TGXMetaModel         from "./TGXMeta.js"
import OutsideMetaModel     from "./OutsideMeta.js"
import CommissionModel      from "./Commission.js"

import AddOnModel           from "./AddOn.js"
import AddOnOptionModel     from "./AddOnOption.js"
import BookingAddOnModel    from "./BookingAddOn.js"

import HotelAddOnModel      from "./HotelAddOn.js"
import HotelAddOnOptionModel from "./HotelAddOnOption.js"
import HotelStaffModel      from "./HotelStaff.js"
import HotelStaffAddOnModel from "./HotelStaffAddOn.js"

import MessageModel         from "./Message.js"
import UpsellCodeModel      from "./UpsellCode.js"
import TgxHotelModel from "./TGXHotel.js"

import WcTenantFactory from './WcTenant.js';
import WcAccountFactory from './WcAccount.js';
import WcSiteConfigFactory from './WcSiteConfig.js';
import WcTemplateFactory from './WcTemplate.js'

/* ---------- Construir objetos ---------- */
const models = {
  User           : UserModel(sequelize),
  StaffRole      : StaffRoleModel(sequelize),
  Staff          : StaffModel(sequelize),

  Hotel          : HotelModel(sequelize),
  HotelImage     : HotelImageModel(sequelize),
  Room           : RoomModel(sequelize),

  DiscountCode   : DiscountCodeModel(sequelize),
  Booking        : BookingModel(sequelize),
  Payment        : PaymentModel(sequelize),        // ← nuevo
  TGXMeta        : TGXMetaModel(sequelize),        // ← nuevo
  OutsideMeta    : OutsideMetaModel(sequelize),    // ← nuevo
  Commission     : CommissionModel(sequelize),

  AddOn          : AddOnModel(sequelize),
  AddOnOption    : AddOnOptionModel(sequelize),
  BookingAddOn   : BookingAddOnModel(sequelize),

  HotelAddOn         : HotelAddOnModel(sequelize),
  HotelAddOnOption   : HotelAddOnOptionModel(sequelize),
  HotelStaff         : HotelStaffModel(sequelize),
  HotelStaffAddOn    : HotelStaffAddOnModel(sequelize),

  Message        : MessageModel(sequelize),
  UpsellCode     : UpsellCodeModel(sequelize),
  TgxHotel       : TgxHotelModel(sequelize),

  WcTenant       : WcTenantFactory(sequelize),
  WcAccount      : WcAccountFactory(sequelize),
  WcSiteConfig   : WcSiteConfigFactory(sequelize),
  WcTemplate     : WcTemplateFactory(sequelize)

}

/* ---------- Ejecutar asociaciones ---------- */
Object.values(models)
  .filter((m) => typeof m.associate === "function")
  .forEach((m) => m.associate(models))

export { sequelize }
export default models
