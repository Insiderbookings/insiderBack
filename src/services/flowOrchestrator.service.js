
import { createHmac, randomUUID } from "crypto";
import models from "../models/index.js";
import { getWebbedsConfig } from "../providers/webbeds/config.js";
import { createWebbedsClient } from "../providers/webbeds/client.js";
import { buildGetRoomsPayload, mapGetRoomsResponse } from "../providers/webbeds/getRooms.js";
import { buildSaveBookingPayload, mapSaveBookingResponse } from "../providers/webbeds/saveBooking.js";
import {
  buildBookItineraryPayload,
  mapBookItineraryResponse,
} from "../providers/webbeds/bookItinerary.js";
import { buildCancelBookingPayload, mapCancelBookingResponse } from "../providers/webbeds/cancelBooking.js";
import { tokenizeCard } from "../providers/webbeds/rezpayments.js";

const FLOW_STATUSES = {
  STARTED: "STARTED",
  OFFER_SELECTED: "OFFER_SELECTED",
  BLOCKED: "BLOCKED",
  SAVED: "SAVED",
  PRICED: "PRICED",
  PREAUTHED: "PREAUTHED",
  CONFIRMED: "CONFIRMED",
  CANCEL_QUOTED: "CANCEL_QUOTED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
};

const STEP_COMMAND = {
  GETROOMS: "getrooms",
  BLOCK: "getrooms",
  SAVEBOOKING: "savebooking",
  BOOK_NO: "bookitinerary",
  PREAUTH: "bookitinerary",
  BOOK_YES: "bookitinerary",
  CANCEL_NO: "cancelbooking",
  CANCEL_YES: "cancelbooking",
};

const ensureArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const toNumberSafe = (value) => {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object") {
    const raw =
      value["#"] ??
      value["#text"] ??
      value.text ??
      value.value ??
      value.amount ??
      value.formatted ??
      null;
    return toNumberSafe(raw);
  }
  return null;
};

const getText = (value) => {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return value["#text"] ?? value["#"] ?? value.text ?? value.value ?? value.amount ?? null;
  }
  return null;
};

const redactXml = (xml) => {
  if (!xml) return xml;
  return xml
    .replace(/<password>.*?<\/password>/gi, "<password>***redacted***</password>")
    .replace(/<token>.*?<\/token>/gi, "<token>***redacted***</token>")
    .replace(/<devicePayload>.*?<\/devicePayload>/gi, "<devicePayload>***redacted***</devicePayload>")
    .replace(/<cardNumber>.*?<\/cardNumber>/gi, "<cardNumber>***redacted***</cardNumber>")
    .replace(/<cvv>.*?<\/cvv>/gi, "<cvv>***redacted***</cvv>");
};

const serializeFlow = (flow) => {
  if (!flow) return null;
  const plain = flow.get ? flow.get({ plain: true }) : flow;
  return {
    id: plain.id,
    status: plain.status,
    statusReason: plain.status_reason,
    searchContext: plain.search_context,
    selectedOffer: plain.selected_offer,
    allocationCurrent: plain.allocation_current,
    itineraryBookingCode: plain.itinerary_booking_code,
    serviceReferenceNumber: plain.service_reference_number,
    supplierOrderCode: plain.supplier_order_code,
    supplierAuthorisationId: plain.supplier_authorisation_id,
    finalBookingCode: plain.final_booking_code,
    bookingReferenceNumber: plain.booking_reference_number,
    pricingSnapshotPriced: plain.pricing_snapshot_priced,
    pricingSnapshotPreauth: plain.pricing_snapshot_preauth,
    pricingSnapshotConfirmed: plain.pricing_snapshot_confirmed,
    cancelQuoteSnapshot: plain.cancel_quote_snapshot,
    cancelResultSnapshot: plain.cancel_result_snapshot,
    createdAt: plain.created_at,
    updatedAt: plain.updated_at,
  };
};

const serializeRoomsParam = (rooms) => {
  if (!rooms) return undefined;
  if (typeof rooms === "string") return rooms;
  if (!Array.isArray(rooms)) return undefined;
  return rooms
    .map((room) => {
      const adults = room?.adults ?? room?.adult ?? 2;
      const childrenAges = ensureArray(room?.children ?? room?.childrenAges ?? room?.kids);
      const childSegment = childrenAges.length ? childrenAges.join("-") : "0";
      return `${adults}|${childSegment}`;
    })
    .join(",");
};

const parseRoomArray = (rooms) => {
  if (!rooms) return [];
  if (Array.isArray(rooms)) return rooms;
  return String(rooms)
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [adultsRaw, kidsRaw] = segment.split("|");
      const adults = Number(adultsRaw) || 0;
      const kids =
        kidsRaw && kidsRaw !== "0"
          ? kidsRaw.split("-").map((age) => Number(age)).filter((age) => !Number.isNaN(age))
          : [];
      return { adults, children: kids };
    });
};

const normalizeCurrency = (value) => {
  const defaultCurrencyCode = process.env.WEBBEDS_DEFAULT_CURRENCY_CODE || "520";
  const str = String(value ?? "").trim();
  if (/^\d+$/.test(str) && Number(str) > 0) return str;
  const upper = str.toUpperCase();
  if (upper === "USD") return "520";
  if (upper === "EUR") return "978";
  if (upper === "GBP") return "826";
  return defaultCurrencyCode;
};
const ensureNumericCode = (value, fallback) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const strValue = String(value).trim();
  return /^\d+$/.test(strValue) ? strValue : fallback;
};

const resolveOfferSecret = () => {
  const secret = process.env.FLOW_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing FLOW_TOKEN_SECRET or JWT_SECRET for offerToken signing");
  }
  return secret;
};

const signOfferToken = (payload) => {
  const secret = resolveOfferSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
};

const verifyOfferToken = (token) => {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw new Error("Invalid offerToken");
  }
  const [data, sig] = token.split(".");
  const secret = resolveOfferSecret();
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  if (sig !== expected) {
    throw new Error("Invalid offerToken signature");
  }
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (payload.exp && Date.now() > Number(payload.exp)) {
    throw new Error("OfferToken expired");
  }
  return payload;
};

const buildOfferPayload = ({
  hotelId,
  fromDate,
  toDate,
  currency,
  roomsRaw,
  room,
  roomType,
  rateBasis,
}) => {
  const ttlSeconds = Number(process.env.FLOW_TOKEN_TTL_SECONDS || 900);
  const now = Date.now();
  // Keep the token small: only essentials to identify the selection and validate TTL/signature.
  return {
    hotelId,
    fromDate,
    toDate,
    currency,
    rooms: roomsRaw,
    roomRunno: room?.runno ?? null,
    roomTypeCode: roomType?.roomTypeCode ?? roomType?.code ?? null,
    rateBasisId: rateBasis?.id ?? null,
    allocationDetails: rateBasis?.allocationDetails ?? null,
    createdAt: now,
    exp: now + ttlSeconds * 1000,
  };
};

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
  }
  return false;
};

const pickAllocationFromResult = (result) => {
  const products = ensureArray(result?.product ?? result?.products?.product);
  for (const product of products) {
    const alloc =
      getText(product?.allocationDetails) ??
      getText(product?.allocationdetails) ??
      getText(product?.allocation);
    if (alloc) return alloc;
    const svcAlloc = ensureArray(product?.testPricesAndAllocation?.service).find(
      (svc) => getText(svc?.allocationDetails) != null,
    );
    if (svcAlloc) return getText(svcAlloc.allocationDetails);
  }
  const bookings = ensureArray(result?.bookings?.booking);
  for (const booking of bookings) {
    const alloc = getText(booking?.allocationDetails);
    if (alloc) return alloc;
  }
  return null;
};

const findRateBasisMatch = (mappedHotel, roomTypeCode, rateBasisId) => {
  const rooms = ensureArray(mappedHotel?.rooms);
  for (const room of rooms) {
    const roomTypes = ensureArray(room?.roomTypes);
    for (const rt of roomTypes) {
      if (String(rt?.roomTypeCode ?? "") !== String(roomTypeCode ?? "")) continue;
      const rb = ensureArray(rt?.rateBases).find(
        (rbItem) => String(rbItem?.id ?? "") === String(rateBasisId ?? ""),
      );
      if (rb) return rb;
    }
  }
  return null;
};

const createWebbedsClientSafe = () => {
  const config = getWebbedsConfig();
  return createWebbedsClient(config);
};

const sharedClient = createWebbedsClientSafe();

const getRequestId = (req) => req?.id || req?.headers?.["x-request-id"];
const logStep = async ({
  flowId,
  step,
  command,
  tid,
  success,
  errorClass,
  errorCode,
  allocationIn,
  allocationOut,
  bookingCodeOut,
  serviceRefOut,
  orderCodeOut,
  authorisationOut,
  pricesOut,
  withinCancellationDeadlineOut,
  requestXml,
  responseXml,
  idempotencyKey,
}) => {
  return models.BookingFlowStep.create({
    id: randomUUID(),
    flow_id: flowId,
    step,
    command,
    tid,
    success,
    error_class: errorClass,
    error_code: errorCode,
    allocation_in: allocationIn,
    allocation_out: allocationOut,
    booking_code_out: bookingCodeOut,
    service_ref_out: serviceRefOut,
    order_code_out: orderCodeOut,
    authorisation_out: authorisationOut,
    prices_out: pricesOut,
    within_cancellation_deadline_out: withinCancellationDeadlineOut,
    request_xml: redactXml(requestXml),
    response_xml: redactXml(responseXml),
    idempotency_key: idempotencyKey || null,
  });
};

const resolveIdempotentStep = async (flowId, step, idempotencyKey) => {
  if (!idempotencyKey) return null;
  return models.BookingFlowStep.findOne({
    where: { flow_id: flowId, step, idempotency_key: idempotencyKey },
    order: [["created_at", "DESC"]],
  });
};

const getBusinessCardToken = async () => {
  const {
    WEBBEDS_CC_NAME,
    WEBBEDS_CC_NUMBER,
    WEBBEDS_CC_EXP_MONTH,
    WEBBEDS_CC_EXP_YEAR,
    WEBBEDS_CC_CVV,
    WEBBEDS_TOKENIZER_URL,
    WEBBEDS_TOKENIZER_AUTH,
  } = process.env;
  if (!WEBBEDS_CC_NUMBER || !WEBBEDS_CC_EXP_MONTH || !WEBBEDS_CC_EXP_YEAR || !WEBBEDS_CC_CVV) {
    throw new Error("Missing WebBeds business card config");
  }
  return tokenizeCard({
    cardName: WEBBEDS_CC_NAME || "Insider Business",
    cardNumber: WEBBEDS_CC_NUMBER,
    expiryYear: WEBBEDS_CC_EXP_YEAR,
    expiryMonth: WEBBEDS_CC_EXP_MONTH,
    securityCode: WEBBEDS_CC_CVV,
    tokenizerUrl: WEBBEDS_TOKENIZER_URL,
    authHeader: WEBBEDS_TOKENIZER_AUTH,
    logger: console,
  });
};
export class FlowOrchestratorService {
  constructor({ client = sharedClient } = {}) {
    this.client = client;
  }

  async start({ body, req }) {
    const {
      hotelId,
      productId,
      fromDate,
      toDate,
      currency,
      rooms,
      passengerNationality,
      passengerCountryOfResidence,
      cityCode,
    } = body || {};

    const resolvedHotelCode = hotelId ?? productId;
    if (!resolvedHotelCode) {
      throw Object.assign(new Error("hotelId (productId) is required"), { status: 400 });
    }

    const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102";
    const occupancies = serializeRoomsParam(rooms);

    const payload = buildGetRoomsPayload({
      checkIn: fromDate,
      checkOut: toDate,
      currency: normalizeCurrency(currency),
      occupancies,
      rateBasis: "-1",
      nationality: ensureNumericCode(passengerNationality, defaultCountryCode),
      residence: ensureNumericCode(passengerCountryOfResidence, defaultCountryCode),
      hotelId: resolvedHotelCode,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send("getrooms", payload, {
      requestId: getRequestId(req),
      productOverride: "hotel",
    });
    const mapped = mapGetRoomsResponse(result);
    const hotel = mapped?.hotel || {};
    const roomsList = ensureArray(hotel.rooms);
    const offers = [];
    roomsList.forEach((room) => {
      ensureArray(room.roomTypes).forEach((roomType) => {
        ensureArray(roomType.rateBases).forEach((rateBasis) => {
          const tokenPayload = buildOfferPayload({
            hotelId: hotel.id ?? resolvedHotelCode,
            fromDate,
            toDate,
            currency: normalizeCurrency(currency),
            roomsRaw: rooms,
            room,
            roomType,
            rateBasis,
          });
          const offerToken = signOfferToken(tokenPayload);
          const priceNumeric =
            toNumberSafe(rateBasis?.total) ??
            toNumberSafe(rateBasis?.totalInRequestedCurrency) ??
            toNumberSafe(rateBasis?.totalMinimumSelling) ??
            toNumberSafe(
              rateBasis?.totalFormatted ??
              rateBasis?.totalMinimumSellingFormatted ??
              rateBasis?.totalInRequestedCurrencyFormatted,
            );
          const minSellingNumeric =
            toNumberSafe(rateBasis?.minimumSelling) ??
            toNumberSafe(rateBasis?.priceMinimumSelling) ??
            toNumberSafe(rateBasis?.totalMinimumSelling) ??
            toNumberSafe(
              rateBasis?.minimumSellingFormatted ??
              rateBasis?.totalMinimumSellingFormatted,
            );
          const nonRefundable = toBoolean(rateBasis?.rateType?.nonRefundable);
          const cancelRestricted = rateBasis?.cancellationRules?.some((r) => r?.cancelRestricted) ?? false;
          const amendRestricted = rateBasis?.cancellationRules?.some((r) => r?.amendRestricted) ?? false;
          offers.push({
            offerToken,
            hotelId: tokenPayload.hotelId,
            hotelName: hotel.name,
            roomRunno: room.runno,
            roomTypeCode: roomType.roomTypeCode,
            roomName: roomType.name,
            rateBasisId: rateBasis.id,
            rateDescription: rateBasis.description,
            allocationDetails: rateBasis.allocationDetails,
            price: priceNumeric,
            priceFormatted:
              rateBasis.totalFormatted ??
              rateBasis.totalMinimumSellingFormatted ??
              rateBasis.totalInRequestedCurrencyFormatted ??
              null,
            minimumSelling:
              minSellingNumeric ??
              rateBasis.minimumSelling ??
              rateBasis.totalMinimumSelling ??
              null,
            minimumSellingFormatted:
              rateBasis.minimumSellingFormatted ?? rateBasis.totalMinimumSellingFormatted ?? null,
            currency: mapped.currency ?? currency,
            cancellationRules: rateBasis.cancellationRules ?? [],
            withinCancellationDeadline: rateBasis.withinCancellationDeadline ?? null,
            refundable: !nonRefundable,
            nonRefundable,
            cancelRestricted,
            amendRestricted,
            tariffNotes: rateBasis.tariffNotes ?? null,
            minStay: rateBasis.minStay ?? null,
            dateApplyMinStay: rateBasis.dateApplyMinStay ?? null,
            changedOccupancy: rateBasis.changedOccupancy ?? null,
            validForOccupancy: rateBasis.validForOccupancy ?? null,
          });
        });
      });
    });

    const flowId = randomUUID();
    const flow = await models.BookingFlow.create({
      id: flowId,
      status: FLOW_STATUSES.STARTED,
      search_context: {
        hotelId: hotel.id ?? resolvedHotelCode,
        fromDate,
        toDate,
        currency: normalizeCurrency(currency),
        rooms,
        passengerNationality: ensureNumericCode(passengerNationality, defaultCountryCode),
        passengerCountryOfResidence: ensureNumericCode(passengerCountryOfResidence, defaultCountryCode),
        cityCode: cityCode ?? null,
      },
    });

    await logStep({
      flowId,
      step: "GETROOMS",
      command: STEP_COMMAND.GETROOMS,
      tid: metadata?.transactionId,
      success: true,
      pricesOut: { offersCount: offers.length },
      requestXml,
      responseXml,
    });

    return { flowId, offers, flow: serializeFlow(flow) };
  }
  async select({ body }) {
    const { flowId, offerToken } = body || {};
    if (!flowId || !offerToken) {
      throw Object.assign(new Error("flowId and offerToken are required"), { status: 400 });
    }
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    const payload = verifyOfferToken(offerToken);
    flow.selected_offer = payload;
    flow.allocation_current = payload.allocationDetails;
    flow.status = FLOW_STATUSES.OFFER_SELECTED;
    await flow.save();
    return { flow: serializeFlow(flow) };
  }

  async block({ body, req }) {
    const { flowId, offerToken, idempotencyKey: bodyIdempotencyKey } = body || {};
    const idempotencyKey = bodyIdempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });

    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    if (!flow.selected_offer) {
      if (!offerToken) {
        throw Object.assign(new Error("offerToken is required to block this flow"), { status: 400 });
      }
      const payload = verifyOfferToken(offerToken);
      flow.selected_offer = payload;
      flow.allocation_current = payload.allocationDetails;
      flow.status = FLOW_STATUSES.OFFER_SELECTED;
      await flow.save();
    }

    const reusedStep = await resolveIdempotentStep(flowId, "BLOCK", idempotencyKey);
    if (reusedStep) {
      return { flow: serializeFlow(flow), idempotent: true };
    }

    const context = flow.search_context || {};
    const payload = buildGetRoomsPayload({
      checkIn: context.fromDate,
      checkOut: context.toDate,
      currency: context.currency,
      occupancies: serializeRoomsParam(context.rooms),
      rateBasis: flow.selected_offer.rateBasisId,
      nationality: context.passengerNationality,
      residence: context.passengerCountryOfResidence,
      hotelId: context.hotelId,
      roomTypeCode: flow.selected_offer.roomTypeCode,
      selectedRateBasis: flow.selected_offer.rateBasisId,
      allocationDetails: flow.allocation_current,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send("getrooms", payload, {
      requestId: getRequestId(req),
      productOverride: "hotel",
    });
    const mapped = mapGetRoomsResponse(result);
    const rateBasis = findRateBasisMatch(
      mapped?.hotel,
      flow.selected_offer.roomTypeCode,
      flow.selected_offer.rateBasisId,
    );
    const allocationIn = flow.allocation_current;
    const newAllocation = getText(rateBasis?.allocationDetails) || allocationIn;

    flow.allocation_current = newAllocation;
    flow.status = FLOW_STATUSES.BLOCKED;
    await flow.save();

    await logStep({
      flowId,
      step: "BLOCK",
      command: STEP_COMMAND.BLOCK,
      tid: metadata?.transactionId,
      success: true,
      allocationIn,
      allocationOut: newAllocation,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async saveBooking({ body, req }) {
    const {
      flowId,
      contact,
      passengers,
      voucherRemark,
      specialRequest,
      rooms: roomsOverride,
      sendCommunicationTo,
    } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    if (!flow.selected_offer) {
      throw Object.assign(new Error("Offer not selected for this flow"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "SAVEBOOKING", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const context = flow.search_context || {};
    const roomsPayload = parseRoomArray(roomsOverride || context.rooms);
    const roomsForSave = roomsPayload.map((room) => ({
      ...room,
      roomTypeCode: flow.selected_offer.roomTypeCode,
      selectedRateBasis: flow.selected_offer.rateBasisId,
      allocationDetails: flow.allocation_current,
    }));

    const payload = buildSaveBookingPayload({
      checkIn: context.fromDate,
      checkOut: context.toDate,
      currency: context.currency,
      hotelId: context.hotelId,
      rateBasis: flow.selected_offer.rateBasisId,
      nationality: context.passengerNationality,
      residence: context.passengerCountryOfResidence,
      rooms: roomsForSave,
      contact: { ...contact, email: sendCommunicationTo ?? contact?.email },
      passengers,
      voucherRemark,
      specialRequest,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send("savebooking", payload, {
      requestId: getRequestId(req),
    });
    const mapped = mapSaveBookingResponse(result);
    const serviceRef = mapped.services?.[0]?.returnedServiceCode ?? null;

    flow.itinerary_booking_code = mapped.returnedCode ?? flow.itinerary_booking_code;
    flow.service_reference_number = serviceRef ?? flow.service_reference_number;
    flow.status = FLOW_STATUSES.SAVED;
    await flow.save();

    await logStep({
      flowId,
      step: "SAVEBOOKING",
      command: STEP_COMMAND.SAVEBOOKING,
      tid: metadata?.transactionId,
      success: true,
      allocationIn: flow.allocation_current,
      allocationOut: flow.allocation_current,
      bookingCodeOut: mapped.returnedCode,
      serviceRefOut: serviceRef,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async price({ body, req }) {
    const { flowId, idempotencyKey: bodyIdempotencyKey } = body || {};
    const idempotencyKey = bodyIdempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    if (!flow.itinerary_booking_code) {
      throw Object.assign(new Error("Flow is missing itinerary booking code"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "BOOK_NO", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const payload = buildBookItineraryPayload({
      bookingCode: flow.itinerary_booking_code,
      bookingType: 2,
      confirm: "no",
      payment: {},
      services: [],
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send(
      "bookitinerary",
      payload,
      { requestId: getRequestId(req), productOverride: null },
    );
    const mapped = mapBookItineraryResponse(result);
    const productNode = Array.isArray(result?.product) ? result.product[0] : result?.product;
    const allocationIn = flow.allocation_current;
    const newAllocation = pickAllocationFromResult(result) || allocationIn;
    const withinCancellationDeadline = productNode
      ? toBoolean(productNode.withinCancellationDeadline ?? productNode.withinCancellationDeadline)
      : null;
    const priceValue =
      getText(productNode?.servicePrice) ??
      getText(productNode?.price) ??
      mapped.services?.[0]?.servicePrice ??
      null;

    flow.allocation_current = newAllocation;
    flow.pricing_snapshot_priced = {
      currency: mapped.currencyShort ?? flow.search_context?.currency ?? null,
      price: priceValue != null ? Number(priceValue) : null,
      serviceCode: flow.service_reference_number ?? mapped.services?.[0]?.returnedServiceCode ?? null,
      allocationDetails: newAllocation,
      cancellationRules: productNode?.cancellationRules ?? null,
      withinCancellationDeadline,
      raw: {
        withinCancellationDeadline,
        priceFormatted: getText(productNode?.servicePrice?.formatted ?? productNode?.price?.formatted),
      },
    };
    flow.status = FLOW_STATUSES.PRICED;
    await flow.save();

    await logStep({
      flowId,
      step: "BOOK_NO",
      command: STEP_COMMAND.BOOK_NO,
      tid: metadata?.transactionId,
      success: true,
      allocationIn,
      allocationOut: newAllocation,
      pricesOut: flow.pricing_snapshot_priced,
      withinCancellationDeadlineOut: withinCancellationDeadline,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async preauth({ body, req }) {
    const { flowId, paymentIntentId, amount } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    if (!flow.itinerary_booking_code) {
      throw Object.assign(new Error("Flow is missing itinerary booking code"), { status: 400 });
    }
    if (!flow.allocation_current) {
      throw Object.assign(new Error("Flow is missing allocation details"), { status: 400 });
    }

    const priceValue =
      amount ??
      flow.pricing_snapshot_priced?.price ??
      flow.pricing_snapshot_preauth?.price ??
      null;
    if (priceValue == null) {
      throw Object.assign(new Error("Missing amount for preauthorization"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "PREAUTH", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const token = await getBusinessCardToken();
    const paymentMethod = process.env.WEBBEDS_PAYMENT_METHOD || "CC_PAYMENT_NET";
    const context = flow.search_context || {};
    const services = [
      {
        serviceCode: flow.service_reference_number,
        testPrice: priceValue,
        allocationDetails: flow.allocation_current,
      },
    ];

    const payload = buildBookItineraryPayload({
      bookingCode: flow.itinerary_booking_code,
      bookingType: 2,
      confirm: "preauth",
      sendCommunicationTo: process.env.WEBBEDS_COMM_EMAIL || undefined,
      payment: {
        paymentMethod,
        usedCredit: 0,
        creditCardCharge: priceValue,
        token,
        cardHolderName: process.env.WEBBEDS_CC_NAME,
        creditCardType: process.env.WEBBEDS_CC_TYPE || 100,
        authorisationId: paymentIntentId,
        devicePayload: process.env.WEBBEDS_DEVICE_PAYLOAD || "static-device",
        endUserIPAddress: process.env.WEBBEDS_DEFAULT_IP || "127.0.0.1",
      },
      services,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send(
      "bookitinerary",
      payload,
      { requestId: getRequestId(req), productOverride: null },
    );
    const mapped = mapBookItineraryResponse(result);
    const allocationIn = flow.allocation_current;
    const newAllocation = pickAllocationFromResult(result) || allocationIn;
    flow.allocation_current = newAllocation;
    flow.supplier_order_code = mapped.orderCode ?? flow.supplier_order_code;
    flow.supplier_authorisation_id =
      mapped.authorizationId ?? mapped.threeDSData?.authorizationId ?? flow.supplier_authorisation_id;
    flow.pricing_snapshot_preauth = {
      ...flow.pricing_snapshot_priced,
      orderCode: mapped.orderCode,
      authorisationId: mapped.authorizationId ?? mapped.threeDSData?.authorizationId,
      threeDSData: mapped.threeDSData,
      allocationDetails: newAllocation,
      currency: mapped.currencyShort ?? flow.pricing_snapshot_priced?.currency ?? context.currency,
      price: priceValue,
    };
    flow.status = FLOW_STATUSES.PREAUTHED;
    await flow.save();

    await logStep({
      flowId,
      step: "PREAUTH",
      command: STEP_COMMAND.PREAUTH,
      tid: metadata?.transactionId,
      success: true,
      allocationIn,
      allocationOut: newAllocation,
      orderCodeOut: mapped.orderCode,
      authorisationOut:
        mapped.authorizationId ?? mapped.threeDSData?.authorizationId ?? flow.supplier_authorisation_id,
      pricesOut: flow.pricing_snapshot_preauth,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async confirm({ body, req }) {
    const { flowId } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    if (!flow.itinerary_booking_code || !flow.service_reference_number) {
      throw Object.assign(new Error("Flow missing itinerary or service reference"), { status: 400 });
    }

    const priceValue =
      flow.pricing_snapshot_preauth?.price ??
      flow.pricing_snapshot_priced?.price ??
      null;
    if (priceValue == null) {
      throw Object.assign(new Error("Flow is missing price for confirmation"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "BOOK_YES", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const services = [
      {
        serviceCode: flow.service_reference_number,
        testPrice: priceValue,
        allocationDetails: flow.allocation_current,
      },
    ];

    const paymentMethod = process.env.WEBBEDS_PAYMENT_METHOD || "CC_PAYMENT_NET";
    const payload = buildBookItineraryPayload({
      bookingCode: flow.itinerary_booking_code,
      bookingType: 1,
      confirm: "yes",
      payment: {
        paymentMethod,
        creditCardCharge: priceValue,
        orderCode: flow.supplier_order_code,
        authorisationId: flow.supplier_authorisation_id,
      },
      services,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send(
      "bookitinerary",
      payload,
      { requestId: getRequestId(req), productOverride: null },
    );
    const mapped = mapBookItineraryResponse(result);
    const allocationIn = flow.allocation_current;
    const newAllocation = pickAllocationFromResult(result) || allocationIn;
    const booking = ensureArray(mapped.bookings)[0] || {};

    flow.allocation_current = newAllocation;
    flow.final_booking_code = booking.bookingCode ?? mapped.returnedCode ?? flow.final_booking_code;
    flow.booking_reference_number =
      booking.bookingReferenceNumber ?? flow.booking_reference_number ?? null;
    flow.pricing_snapshot_confirmed = {
      ...flow.pricing_snapshot_preauth,
      allocationDetails: newAllocation,
      bookingCode: flow.final_booking_code,
      bookingReferenceNumber: flow.booking_reference_number,
    };
    flow.status = FLOW_STATUSES.CONFIRMED;
    await flow.save();

    await logStep({
      flowId,
      step: "BOOK_YES",
      command: STEP_COMMAND.BOOK_YES,
      tid: metadata?.transactionId,
      success: true,
      allocationIn,
      allocationOut: newAllocation,
      bookingCodeOut: flow.final_booking_code,
      orderCodeOut: flow.supplier_order_code,
      authorisationOut: flow.supplier_authorisation_id,
      pricesOut: flow.pricing_snapshot_confirmed,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async cancelQuote({ body, req }) {
    const { flowId, comment } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    const bookingCode = flow.final_booking_code || flow.itinerary_booking_code;
    if (!bookingCode) {
      throw Object.assign(new Error("Flow missing booking code for cancellation"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "CANCEL_NO", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const payload = buildCancelBookingPayload({
      bookingCode,
      bookingType: 1,
      confirm: "no",
      reason: comment,
      services: [],
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send(
      "cancelbooking",
      payload,
      { requestId: getRequestId(req), productOverride: null },
    );
    const mapped = mapCancelBookingResponse(result);

    flow.cancel_quote_snapshot = mapped;
    flow.status = FLOW_STATUSES.CANCEL_QUOTED;
    await flow.save();

    await logStep({
      flowId,
      step: "CANCEL_NO",
      command: STEP_COMMAND.CANCEL_NO,
      tid: metadata?.transactionId,
      success: true,
      bookingCodeOut: bookingCode,
      pricesOut: mapped,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }

  async cancel({ body, req }) {
    const { flowId, comment } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    const bookingCode = flow.final_booking_code || flow.itinerary_booking_code;
    if (!bookingCode) {
      throw Object.assign(new Error("Flow missing booking code for cancellation"), { status: 400 });
    }

    const penalty =
      flow.cancel_quote_snapshot?.services?.[0]?.cancellationPenalties?.[0] ?? null;
    const penaltyApplied = penalty?.charge ?? penalty?.penaltyApplied ?? null;
    const paymentBalance =
      penaltyApplied != null
        ? penaltyApplied
        : flow.pricing_snapshot_confirmed?.price ?? flow.pricing_snapshot_priced?.price ?? null;

    const services = [
      {
        serviceCode: flow.service_reference_number || bookingCode,
        penaltyApplied,
        paymentBalance,
      },
    ];

    const reusedStep = await resolveIdempotentStep(flowId, "CANCEL_YES", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const payload = buildCancelBookingPayload({
      bookingCode,
      bookingType: 1,
      confirm: "yes",
      reason: comment,
      services,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send(
      "cancelbooking",
      payload,
      { requestId: getRequestId(req), productOverride: null },
    );
    const mapped = mapCancelBookingResponse(result);

    flow.cancel_result_snapshot = mapped;
    flow.status = FLOW_STATUSES.CANCELLED;
    await flow.save();

    await logStep({
      flowId,
      step: "CANCEL_YES",
      command: STEP_COMMAND.CANCEL_YES,
      tid: metadata?.transactionId,
      success: true,
      bookingCodeOut: bookingCode,
      pricesOut: mapped,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { flow: serializeFlow(flow) };
  }
  async getFlow(flowId) {
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    return serializeFlow(flow);
  }

  async getSteps(flowId, { includeXml = false } = {}) {
    const flow = await models.BookingFlow.findByPk(flowId);
    if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });
    const steps = await models.BookingFlowStep.findAll({
      where: { flow_id: flowId },
      order: [["created_at", "ASC"]],
    });
    return steps.map((step) => {
      const plain = step.get({ plain: true });
      return {
        id: plain.id,
        step: plain.step,
        command: plain.command,
        tid: plain.tid,
        success: plain.success,
        errorClass: plain.error_class,
        errorCode: plain.error_code,
        allocationIn: plain.allocation_in,
        allocationOut: plain.allocation_out,
        bookingCodeOut: plain.booking_code_out,
        serviceRefOut: plain.service_ref_out,
        orderCodeOut: plain.order_code_out,
        authorisationOut: plain.authorisation_out,
        withinCancellationDeadline: plain.within_cancellation_deadline_out,
        pricesOut: plain.prices_out,
        createdAt: plain.created_at,
        requestXml: includeXml ? plain.request_xml : undefined,
        responseXml: includeXml ? plain.response_xml : undefined,
      };
    });
  }
}

export default FlowOrchestratorService;
