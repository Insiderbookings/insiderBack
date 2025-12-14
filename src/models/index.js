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
import HotelAliasModel from "./HotelAlias.js";
import BadgeModel from "./Badge.js";
import HomeBadgeModel from "./HomeBadge.js";
import HostBadgeModel from "./HostBadge.js";
import StayModel from "./Stay.js";
import StayHotelModel from "./StayHotel.js";
import StayHomeModel from "./StayHome.js";
import StayManualModel from "./StayManual.js";
import PaymentModel from "./Payment.js";
import CommissionModel from "./Commission.js";
import InfluencerCommissionModel from "./InfluencerCommission.js";
import OutsideMetaModel from "./OutsideMeta.js";
import TGXMetaModel from "./TGXMeta.js";
import PayoutAccountModel from "./PayoutAccount.js";
import PayoutBatchModel from "./PayoutBatch.js";
import PayoutItemModel from "./PayoutItem.js";

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
import GuestProfileModel from "./GuestProfile.js";
import HomeFavoriteModel from "./HomeFavorite.js";
import HomeFavoriteListModel from "./HomeFavoriteList.js";
import HomeRecentViewModel from "./HomeRecentView.js";
import WebbedsCountryModel from "./WebbedsCountry.js";
import WebbedsCityModel from "./WebbedsCity.js";
import WebbedsHotelModel from "./WebbedsHotel.js";
import WebbedsHotelImageModel from "./WebbedsHotelImage.js";
import WebbedsHotelAmenityModel from "./WebbedsHotelAmenity.js";
import WebbedsHotelGeoLocationModel from "./WebbedsHotelGeoLocation.js";
import WebbedsHotelRoomTypeModel from "./WebbedsHotelRoomType.js";
import WebbedsSyncLogModel from "./WebbedsSyncLog.js";
import WebbedsCurrencyModel from "./WebbedsCurrency.js";
import WebbedsAmenityCatalogModel from "./WebbedsAmenityCatalog.js";
import WebbedsRoomAmenityCatalogModel from "./WebbedsRoomAmenityCatalog.js";
import WebbedsHotelChainModel from "./WebbedsHotelChain.js";
import WebbedsHotelClassificationModel from "./WebbedsHotelClassification.js";
import WebbedsRateBasisModel from "./WebbedsRateBasis.js";

import WcTenantFactory from "./WcTenant.js";
import WcAccountFactory from "./WcAccount.js";
import WcAccountTenantFactory from "./WcAccountTenant.js";
import WcUserTenantFactory from "./WcUserTenant.js";
import WcSiteConfigFactory from "./WcSiteConfig.js";
import WcTemplateFactory from "./WcTemplate.js";
import PlatformFactory from "./Platform.js";
import WcTenantPlatformFactory from "./WcTenantPlatform.js";
import UserRoleRequestFactory from "./UserRoleRequest.js";
import WcVCardFactory from "./WcVCard.js";
import WcOperatorTransferFactory from "./WcOperatorTransfer.js";
import VaultOperatorNameFactory from "./VaultOperatorName.js";
import SubscriberFactory from "./Subscriber.js";
import ContractFactory from "./Contract.js";
import UserContractFactory from "./UserContract.js";

import ChatThreadModel from "./ChatThread.js";
import ChatParticipantModel from "./ChatParticipant.js";
import ChatMessageModel from "./ChatMessage.js";
import ChatAutoPromptModel from "./ChatAutoPrompt.js";
import ReviewModel from "./Review.js";
import AiChatSessionModel from "./AiChatSession.js";
import AiChatMessageModel from "./AiChatMessage.js";

/* ---------- Construir objetos ---------- */
const Stay = StayModel(sequelize);

const models = {
  User: UserModel(sequelize),
  StaffRole: StaffRoleModel(sequelize),
  Staff: StaffModel(sequelize),

  Hotel: HotelModel(sequelize),
  HotelImage: HotelImageModel(sequelize),
  HotelAlias: HotelAliasModel(sequelize),
  Badge: BadgeModel(sequelize),
  HomeBadge: HomeBadgeModel(sequelize),
  HostBadge: HostBadgeModel(sequelize),
  Room: RoomModel(sequelize),

  DiscountCode: DiscountCodeModel(sequelize),
  Stay,
  Booking: Stay, // alias temporal para compatibilidad
  StayHotel: StayHotelModel(sequelize),
  StayHome: StayHomeModel(sequelize),
  StayManual: StayManualModel(sequelize),
  Payment: PaymentModel(sequelize),
  Commission: CommissionModel(sequelize),
  InfluencerCommission: InfluencerCommissionModel(sequelize),
  OutsideMeta: OutsideMetaModel(sequelize),
  TGXMeta: TGXMetaModel(sequelize),
  PayoutAccount: PayoutAccountModel(sequelize),
  PayoutBatch: PayoutBatchModel(sequelize),
  PayoutItem: PayoutItemModel(sequelize),

  AddOn: AddOnModel(sequelize),
  AddOnOption: AddOnOptionModel(sequelize),
  BookingAddOn: BookingAddOnModel(sequelize),

  HotelAddOn: HotelAddOnModel(sequelize),
  HotelAddOnOption: HotelAddOnOptionModel(sequelize),
  HotelStaff: HotelStaffModel(sequelize),
  HotelStaffAddOn: HotelStaffAddOnModel(sequelize),

  Message: MessageModel(sequelize),
  ChatThread: ChatThreadModel(sequelize),
  ChatParticipant: ChatParticipantModel(sequelize),
  ChatMessage: ChatMessageModel(sequelize),
  ChatAutoPrompt: ChatAutoPromptModel(sequelize),
  AiChatSession: AiChatSessionModel(sequelize),
  AiChatMessage: AiChatMessageModel(sequelize),
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
  HomeFavorite: HomeFavoriteModel(sequelize),
  HomeFavoriteList: HomeFavoriteListModel(sequelize),
  HomeRecentView: HomeRecentViewModel(sequelize),
  HostProfile: HostProfileModel(sequelize),
  GuestProfile: GuestProfileModel(sequelize),
  WebbedsCountry: WebbedsCountryModel(sequelize),
  WebbedsCity: WebbedsCityModel(sequelize),
  WebbedsHotel: WebbedsHotelModel(sequelize),
  WebbedsHotelImage: WebbedsHotelImageModel(sequelize),
  WebbedsHotelAmenity: WebbedsHotelAmenityModel(sequelize),
  WebbedsHotelGeoLocation: WebbedsHotelGeoLocationModel(sequelize),
  WebbedsHotelRoomType: WebbedsHotelRoomTypeModel(sequelize),
  WebbedsSyncLog: WebbedsSyncLogModel(sequelize),
  WebbedsCurrency: WebbedsCurrencyModel(sequelize),
  WebbedsAmenityCatalog: WebbedsAmenityCatalogModel(sequelize),
  WebbedsRoomAmenityCatalog: WebbedsRoomAmenityCatalogModel(sequelize),
  WebbedsHotelChain: WebbedsHotelChainModel(sequelize),
  WebbedsHotelClassification: WebbedsHotelClassificationModel(sequelize),
  WebbedsRateBasis: WebbedsRateBasisModel(sequelize),

  WcTenant: WcTenantFactory(sequelize),
  WcAccount: WcAccountFactory(sequelize),
  WcAccountTenant: WcAccountTenantFactory(sequelize),
  WcUserTenant: WcUserTenantFactory(sequelize),
  WcSiteConfig: WcSiteConfigFactory(sequelize),
  WcTemplate: WcTemplateFactory(sequelize),
  Platform: PlatformFactory(sequelize),
  WcTenantPlatform: WcTenantPlatformFactory(sequelize),

  UserRoleRequest: UserRoleRequestFactory(sequelize),
  WcOperatorTransfer: WcOperatorTransferFactory(sequelize),
  WcVCard: WcVCardFactory(sequelize),
  VaultOperatorName: VaultOperatorNameFactory(sequelize),
  Subscriber: SubscriberFactory(sequelize),
  Contract: ContractFactory(sequelize),
  UserContract: UserContractFactory(sequelize),
  Review: ReviewModel(sequelize),
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
