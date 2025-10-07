// src/models/index.js
import sequelize from "../config/database.js";

/* ---------- Importar modelos ---------- */
import UserModel from "./User.js";
import StaffRoleModel from "./StaffRole.js";
import StaffModel from "./Staff.js";
import HotelModel from "./Hotel.js";
import HotelImageModel from "./HotelImage.js";
import RoomModel from "./Room.js";
import DiscountCodeModel from "./DiscountCode.js";
import StayModel from "./Stay.js";
import StayHotelModel from "./StayHotel.js";
import StayHomeModel from "./StayHome.js";
import StayManualModel from "./StayManual.js";
import PaymentModel from "./Payment.js";
import TGXMetaModel from "./TGXMeta.js";
import OutsideMetaModel from "./OutsideMeta.js";
import CommissionModel from "./Commission.js";
import InfluencerCommissionModel from "./InfluencerCommission.js";

import AddOnModel from "./AddOn.js";
import AddOnOptionModel from "./AddonOption.js";
import BookingAddOnModel from "./BookingAddOn.js";

import HotelAddOnModel from "./HotelAddOn.js";
import HotelAddOnOptionModel from "./HotelAddOnOption.js";
import HotelStaffModel from "./HotelStaff.js";
import HotelStaffAddOnModel from "./HotelStaffAddOn.js";

import MessageModel from "./Message.js";
import UpsellCodeModel from "./UpsellCode.js";
import TgxHotelModel from "./TGXHotel.js";

import HomeModel from "./Home.js";
import HomeAddressModel from "./HomeAddress.js";
import HomeAmenityModel from "./HomeAmenity.js";
import HomeAmenityLinkModel from "./HomeAmenityLink.js";
import HomeMediaModel from "./HomeMedia.js";
import HomePricingModel from "./HomePricing.js";
import HomeCalendarModel from "./HomeCalendar.js";
import HomeDiscountRuleModel from "./HomeDiscountRule.js";
import HomePoliciesModel from "./HomePolicies.js";
import HomeSecurityModel from "./HomeSecurity.js";
import HomeTagModel from "./HomeTag.js";
import HomeTagLinkModel from "./HomeTagLink.js";
import HomeFeatureModel from "./HomeFeature.js";
import HostProfileModel from "./HostProfile.js";

import WcTenantFactory from "./WcTenant.js";
import WcAccountFactory from "./WcAccount.js";
import WcAccountTenantFactory from "./WcAccountTenant.js";
import WcUserTenantFactory from "./WcUserTenant.js";
import WcSiteConfigFactory from "./WcSiteConfig.js";
import WcTemplateFactory from "./WcTemplate.js";
import UserRoleRequestFactory from "./UserRoleRequest.js";
import WcVCardFactory from "./WcVCard.js";
import WcOperatorTransferFactory from "./WcOperatorTransfer.js";
import VaultOperatorNameFactory from "./VaultOperatorName.js";
import SubscriberFactory from "./Subscriber.js";
import ContractFactory from "./Contract.js";
import UserContractFactory from "./UserContract.js";

/* ---------- Construir objetos ---------- */
const Stay = StayModel(sequelize);

const models = {
  User: UserModel(sequelize),
  StaffRole: StaffRoleModel(sequelize),
  Staff: StaffModel(sequelize),

  Hotel: HotelModel(sequelize),
  HotelImage: HotelImageModel(sequelize),
  Room: RoomModel(sequelize),

  DiscountCode: DiscountCodeModel(sequelize),
  Stay,
  Booking: Stay, // alias temporal para compatibilidad
  StayHotel: StayHotelModel(sequelize),
  StayHome: StayHomeModel(sequelize),
  StayManual: StayManualModel(sequelize),
  Payment: PaymentModel(sequelize),
  TGXMeta: TGXMetaModel(sequelize),
  OutsideMeta: OutsideMetaModel(sequelize),
  Commission: CommissionModel(sequelize),
  InfluencerCommission: InfluencerCommissionModel(sequelize),

  AddOn: AddOnModel(sequelize),
  AddOnOption: AddOnOptionModel(sequelize),
  BookingAddOn: BookingAddOnModel(sequelize),

  HotelAddOn: HotelAddOnModel(sequelize),
  HotelAddOnOption: HotelAddOnOptionModel(sequelize),
  HotelStaff: HotelStaffModel(sequelize),
  HotelStaffAddOn: HotelStaffAddOnModel(sequelize),

  Message: MessageModel(sequelize),
  UpsellCode: UpsellCodeModel(sequelize),
  TgxHotel: TgxHotelModel(sequelize),

  Home: HomeModel(sequelize),
  HomeAddress: HomeAddressModel(sequelize),
  HomeAmenity: HomeAmenityModel(sequelize),
  HomeAmenityLink: HomeAmenityLinkModel(sequelize),
  HomeMedia: HomeMediaModel(sequelize),
  HomePricing: HomePricingModel(sequelize),
  HomeCalendar: HomeCalendarModel(sequelize),
  HomeDiscountRule: HomeDiscountRuleModel(sequelize),
  HomePolicies: HomePoliciesModel(sequelize),
  HomeSecurity: HomeSecurityModel(sequelize),
  HomeTag: HomeTagModel(sequelize),
  HomeTagLink: HomeTagLinkModel(sequelize),
  HomeFeature: HomeFeatureModel(sequelize),
  HostProfile: HostProfileModel(sequelize),

  WcTenant: WcTenantFactory(sequelize),
  WcAccount: WcAccountFactory(sequelize),
  WcAccountTenant: WcAccountTenantFactory(sequelize),
  WcUserTenant: WcUserTenantFactory(sequelize),
  WcSiteConfig: WcSiteConfigFactory(sequelize),
  WcTemplate: WcTemplateFactory(sequelize),

  UserRoleRequest: UserRoleRequestFactory(sequelize),
  WcOperatorTransfer: WcOperatorTransferFactory(sequelize),
  WcVCard: WcVCardFactory(sequelize),
  VaultOperatorName: VaultOperatorNameFactory(sequelize),
  Subscriber: SubscriberFactory(sequelize),
  Contract: ContractFactory(sequelize),
  UserContract: UserContractFactory(sequelize),
};

/* ---------- Ejecutar asociaciones ---------- */
const associated = new Set();
Object.values(models)
  .filter((m) => typeof m?.associate === "function")
  .forEach((m) => {
    if (associated.has(m)) return;
    associated.add(m);
    m.associate(models);
  });;

export { sequelize };
export default models;

