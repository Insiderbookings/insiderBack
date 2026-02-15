
import { createHmac, randomUUID } from "crypto";
import models from "../models/index.js";
import { getWebbedsConfig } from "../providers/webbeds/config.js";
import { createWebbedsClient, WebbedsError } from "../providers/webbeds/client.js";
import { buildGetRoomsPayload, mapGetRoomsResponse } from "../providers/webbeds/getRooms.js";
import { buildSaveBookingPayload, mapSaveBookingResponse } from "../providers/webbeds/saveBooking.js";
import {
  buildBookItineraryPayload,
  mapBookItineraryResponse,
} from "../providers/webbeds/bookItinerary.js";
import { buildCancelBookingPayload, mapCancelBookingResponse } from "../providers/webbeds/cancelBooking.js";
import { tokenizeCard } from "../providers/webbeds/rezpayments.js";
import { logCurrencyDebug } from "../utils/currencyDebug.js";
import { convertCurrency } from "./currency.service.js";
import { resolveEnabledCurrency } from "./currencySettings.service.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const RETRYABLE_WEBBEDS_CODES = new Set([
  "8", "20", "25", "31", "67", "900", "901", "53", "63", "5300", "696",
  "115", "116", "119", "117", "132", "190", "65002", "86000",
]);
const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);
const RETRYABLE_ERRNOS = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

const isRetryablePriceError = (error) => {
  if (!error) return false;
  if (error.name === "WebbedsError") {
    const code = error.code != null ? String(error.code) : "";
    if (RETRYABLE_WEBBEDS_CODES.has(code)) return true;
    if (error.httpStatus && RETRYABLE_HTTP_STATUSES.has(Number(error.httpStatus))) return true;
  }
  if (error.code && RETRYABLE_ERRNOS.has(String(error.code))) return true;
  if (error.httpStatus && RETRYABLE_HTTP_STATUSES.has(Number(error.httpStatus))) return true;
  return false;
};

const getRetryDelayMs = (attempt, baseDelay, maxDelay) => {
  const cappedBase = Math.max(100, Number(baseDelay) || 600);
  const max = Math.max(cappedBase, Number(maxDelay) || 5000);
  const delay = Math.min(cappedBase * Math.pow(2, attempt - 1), max);
  const jitter = Math.floor(Math.random() * 200);
  return delay + jitter;
};

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

const FLOW_VERBOSE_LOGS = process.env.WEBBEDS_VERBOSE_LOGS === "true";

const isPrivilegedUser = (user) => {
  const role = Number(user?.role);
  return role === 1 || role === 100;
};

const resolveUserId = (req) => {
  const raw = req?.user?.id;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const requireFlowAccess = async ({ flowId, user }) => {
  if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
  const flow = await models.BookingFlow.findByPk(flowId);
  if (!flow) throw Object.assign(new Error("Flow not found"), { status: 404 });

  const userId = Number(user?.id);
  if (!isPrivilegedUser(user)) {
    if (!userId) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    if (!flow.user_id || Number(flow.user_id) !== userId) {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    }
  }

  return flow;
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

const REDACT_XML = process.env.WEBBEDS_REDACT_XML !== "false";
const redactXml = (xml) => {
  if (!xml || !REDACT_XML) return xml;
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
      let childSegment = childrenAges.length ? childrenAges.join("-") : "0";
      // Preserve single child age vs. count when serializing.
      if (childrenAges.length === 1 && !childSegment.includes("-")) {
        childSegment = `${childSegment}-`;
      }
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

const normalizeCurrency = () => {
  // WebBeds account is USD-only; force USD currency code (520) for all requests.
  return "520";
};
const normalizeRateBasis = (value) => {
  if (value === undefined || value === null || value === "") return "-1";
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  const str = String(value).trim();
  if (/^\d+$/.test(str) && Number(str) > 0) return str;
  return "-1";
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
  const rateTotal =
    toNumberSafe(rateBasis?.total) ??
    toNumberSafe(rateBasis?.totalInRequestedCurrency) ??
    toNumberSafe(rateBasis?.totalMinimumSelling) ??
    toNumberSafe(rateBasis?.minimumSelling) ??
    null;
  // Keep the token small: only essentials to identify the selection and validate TTL/signature.
  return {
    hotelId,
    fromDate,
    toDate,
    currency,
    rooms: roomsRaw,
    roomRunno: room?.runno ?? null,
    roomTypeCode: roomType?.roomTypeCode ?? roomType?.code ?? null,
    roomName: roomType?.name ?? null,
    rateBasisId: rateBasis?.id ?? null,
    rateBasisName: rateBasis?.description ?? null,
    mealPlan: rateBasis?.mealPlan ?? rateBasis?.includedMeal?.mealName ?? null,
    specials: rateBasis?.specials ?? [],
    tariffNotes: rateBasis?.tariffNotes ?? null,
    cancellationRules: rateBasis?.cancellationRules ?? [],
    refundable: rateBasis?.rateType?.nonRefundable != null
      ? !Boolean(rateBasis?.rateType?.nonRefundable)
      : rateBasis?.refundable ?? null,
    nonRefundable: rateBasis?.rateType?.nonRefundable ?? rateBasis?.nonRefundable ?? null,
    cancelRestricted: rateBasis?.cancellationRules?.some((r) => r?.cancelRestricted) ?? false,
    amendRestricted: rateBasis?.cancellationRules?.some((r) => r?.amendRestricted) ?? false,
    paymentMode: rateBasis?.paymentMode ?? null,
    totalTaxes: rateBasis?.totalTaxes ?? null,
    totalFee: rateBasis?.totalFee ?? null,
    propertyFees: rateBasis?.propertyFees ?? [],
    allocationDetails: rateBasis?.allocationDetails ?? null,
    price: rateTotal,
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

const resolveRateBasisPrice = (rateBasis) =>
  toNumberSafe(rateBasis?.total) ??
  toNumberSafe(rateBasis?.totalInRequestedCurrency) ??
  toNumberSafe(rateBasis?.totalMinimumSelling) ??
  toNumberSafe(rateBasis?.minimumSelling) ??
  null;

const resolveRateBasisNonRefundable = (rateBasis) => {
  const raw = rateBasis?.rateType?.nonRefundable ?? rateBasis?.nonRefundable;
  if (raw == null) return null;
  return toBoolean(raw);
};

const resolveRateBasisCancelRestricted = (rateBasis) => {
  const rules = ensureArray(rateBasis?.cancellationRules);
  if (!rules.length) return null;
  return rules.some((rule) => toBoolean(rule?.cancelRestricted));
};

const resolveRateBasisAmendRestricted = (rateBasis) => {
  const rules = ensureArray(rateBasis?.cancellationRules);
  if (!rules.length) return null;
  return rules.some((rule) => toBoolean(rule?.amendRestricted));
};

const getRateMatchScore = ({ candidate, selected }) => {
  let score = 0;
  const candidateAllocation = getText(candidate?.allocationDetails) ?? "";
  const selectedAllocation = getText(selected?.allocationDetails) ?? "";
  if (selectedAllocation) {
    score += candidateAllocation === selectedAllocation ? 120 : -60;
  }

  const candidateNonRefundable = resolveRateBasisNonRefundable(candidate);
  const selectedNonRefundable =
    selected?.nonRefundable == null ? null : toBoolean(selected?.nonRefundable);
  if (selectedNonRefundable != null && candidateNonRefundable != null) {
    score += candidateNonRefundable === selectedNonRefundable ? 60 : -60;
  }

  const candidateCancelRestricted = resolveRateBasisCancelRestricted(candidate);
  const selectedCancelRestricted =
    selected?.cancelRestricted == null ? null : toBoolean(selected?.cancelRestricted);
  if (selectedCancelRestricted != null && candidateCancelRestricted != null) {
    score += candidateCancelRestricted === selectedCancelRestricted ? 30 : -30;
  }

  const candidateAmendRestricted = resolveRateBasisAmendRestricted(candidate);
  const selectedAmendRestricted =
    selected?.amendRestricted == null ? null : toBoolean(selected?.amendRestricted);
  if (selectedAmendRestricted != null && candidateAmendRestricted != null) {
    score += candidateAmendRestricted === selectedAmendRestricted ? 20 : -20;
  }

  const selectedPrice = toNumberSafe(selected?.price);
  const candidatePrice = resolveRateBasisPrice(candidate);
  const priceDiff =
    Number.isFinite(selectedPrice) && Number.isFinite(candidatePrice)
      ? Math.abs(candidatePrice - selectedPrice)
      : Number.MAX_SAFE_INTEGER;
  if (Number.isFinite(selectedPrice) && Number.isFinite(candidatePrice)) {
    const safeBase = Math.max(1, Math.abs(selectedPrice));
    score -= priceDiff / safeBase;
  }

  return { score, priceDiff };
};

const findRateBasisMatch = (mappedHotel, selectedOffer = {}) => {
  const roomTypeCode = selectedOffer?.roomTypeCode;
  const rateBasisId = selectedOffer?.rateBasisId;
  const rooms = ensureArray(mappedHotel?.rooms);
  let fallbackCandidates = [];
  for (const room of rooms) {
    const roomTypes = ensureArray(room?.roomTypes);
    for (const rt of roomTypes) {
      if (String(rt?.roomTypeCode ?? "") !== String(roomTypeCode ?? "")) continue;
      const candidates = ensureArray(rt?.rateBases).filter(
        (rbItem) => String(rbItem?.id ?? "") === String(rateBasisId ?? ""),
      );
      if (!candidates.length) continue;
      fallbackCandidates = candidates;
      const ranked = candidates
        .map((candidate) => ({
          candidate,
          ...getRateMatchScore({ candidate, selected: selectedOffer }),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.priceDiff - b.priceDiff;
        });
      if (ranked.length) return ranked[0].candidate;
      return candidates[0] ?? null;
    }
  }
  return fallbackCandidates[0] ?? null;
};

const buildNoAvailabilityError = ({
  message = "Selected rate is no longer available.",
  requestXml,
  responseXml,
  metadata,
} = {}) =>
  new WebbedsError(message, {
    command: STEP_COMMAND.GETROOMS,
    code: "12",
    details: message,
    requestXml,
    responseXml,
    metadata,
  });

const attachOfferTokensToRooms = (mapped, offers = []) => {
  if (!mapped?.hotel?.rooms || !Array.isArray(offers) || !offers.length) return mapped;
  const offerMap = new Map();
  offers.forEach((offer) => {
    const key = `${String(offer?.roomRunno ?? "")}:${String(offer?.roomTypeCode ?? "")}:${String(
      offer?.rateBasisId ?? "",
    )}`;
    const queue = offerMap.get(key) ?? [];
    queue.push(offer);
    offerMap.set(key, queue);
  });
  const rooms = ensureArray(mapped.hotel.rooms).map((room) => ({
    ...room,
    roomTypes: ensureArray(room?.roomTypes).map((roomType) => ({
      ...roomType,
      rateBases: ensureArray(roomType?.rateBases).map((rateBasis) => {
        const key = `${String(room?.runno ?? "")}:${String(roomType?.roomTypeCode ?? "")}:${String(
          rateBasis?.id ?? "",
        )}`;
        const queue = offerMap.get(key) ?? [];
        let offerToken = null;
        if (queue.length) {
          const selected = queue
            .map((offer) => ({
              offer,
              ...getRateMatchScore({ candidate: rateBasis, selected: offer }),
            }))
            .sort((a, b) => {
              if (b.score !== a.score) return b.score - a.score;
              return a.priceDiff - b.priceDiff;
            })[0]?.offer;
          if (selected) {
            offerToken = selected.offerToken ?? null;
            const idx = queue.indexOf(selected);
            if (idx >= 0) queue.splice(idx, 1);
            offerMap.set(key, queue);
          }
        }
        return {
          ...rateBasis,
          offerToken,
        };
      }),
    })),
  }));
  return {
    ...mapped,
    hotel: {
      ...mapped.hotel,
      rooms,
    },
  };
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
      rateBasis,
    } = body || {};

    const userId = resolveUserId(req);
    if (!userId) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }

    const resolvedHotelCode = hotelId ?? productId;
    if (!resolvedHotelCode) {
      throw Object.assign(new Error("hotelId (productId) is required"), { status: 400 });
    }

    const defaultCountryCode = process.env.WEBBEDS_DEFAULT_COUNTRY_CODE || "102";

    logCurrencyDebug("flows.start.input", {
      currency,
      rooms,
      fromDate,
      toDate,
    });
    const occupancies = serializeRoomsParam(rooms);
    logCurrencyDebug("flows.start.occupancies", { occupancies });

    const payload = buildGetRoomsPayload({
      checkIn: fromDate,
      checkOut: toDate,
      currency: normalizeCurrency(currency),
      occupancies,
      rateBasis: normalizeRateBasis(rateBasis),
      nationality: ensureNumericCode(passengerNationality, defaultCountryCode),
      residence: ensureNumericCode(passengerCountryOfResidence, defaultCountryCode),
      hotelId: resolvedHotelCode,
    });
    logCurrencyDebug("flows.start.payload", {
      currencyInput: currency ?? null,
      currencyNormalized: payload.currency ?? null,
      rateBasis: payload.rateBasis ?? null,
      hotelId: resolvedHotelCode,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send("getrooms", payload, {
      requestId: getRequestId(req),
      productOverride: "hotel",
    });
    const mapped = mapGetRoomsResponse(result);
    const sampleRateCurrency = (() => {
      const roomsList = ensureArray(mapped?.hotel?.rooms);
      const roomTypes = roomsList.flatMap((room) => ensureArray(room?.roomTypes));
      const rateBases = roomTypes.flatMap((roomType) => ensureArray(roomType?.rateBases));
      const sampleRate = rateBases[0] ?? null;
      return sampleRate?.currency ?? sampleRate?.currencyShort ?? null;
    })();
    logCurrencyDebug("flows.start.response", {
      responseCurrency: mapped?.currency ?? null,
      sampleRateCurrency,
    });
    const hotel = mapped?.hotel || {};
    const roomsList = ensureArray(hotel.rooms);
    if (FLOW_VERBOSE_LOGS) {
      const roomTypes = roomsList.flatMap((room) => ensureArray(room?.roomTypes));
      const rateBases = roomTypes.flatMap((roomType) => ensureArray(roomType?.rateBases));
      const sampleRate =
        rateBases.find((rate) => {
          if (!rate) return false;
          if (ensureArray(rate?.appliedSpecials ?? rate?.specials).length) return true;
          if (ensureArray(rate?.cancellationRules).length) return true;
          if (ensureArray(rate?.includedMeals).length) return true;
          if (rate?.includedMeal || rate?.mealPlan) return true;
          return false;
        }) ?? rateBases[0] ?? null;
      const specials = ensureArray(sampleRate?.appliedSpecials ?? sampleRate?.specials)
        .map((special) =>
          special?.label ??
          special?.specialName ??
          special?.name ??
          special?.description ??
          special,
        )
        .filter(Boolean)
        .slice(0, 3);
      const cancellationSample = ensureArray(sampleRate?.cancellationRules)
        .slice(0, 2)
        .map((rule) => ({
          from: rule?.fromDateDetails ?? rule?.fromDate ?? null,
          to: rule?.toDateDetails ?? rule?.toDate ?? null,
          charge:
            rule?.formatted ??
            rule?.cancelCharge?.formatted ??
            rule?.amendCharge?.formatted ??
            rule?.cancelCharge ??
            rule?.charge ??
            null,
          currency: rule?.currency ?? null,
        }));
      console.info("[flows] getrooms mapped summary", {
        hotelId: hotel.id ?? resolvedHotelCode,
        currency: mapped.currency ?? currency ?? null,
        roomsCount: roomsList.length,
        roomTypesCount: roomTypes.length,
        rateBasesCount: rateBases.length,
        sampleRate: sampleRate
          ? {
            id: sampleRate.id ?? null,
            total: sampleRate.total ?? null,
            totalFormatted: sampleRate.totalFormatted ?? null,
            totalMinimumSelling: sampleRate.totalMinimumSelling ?? null,
            totalInRequestedCurrency: sampleRate.totalInRequestedCurrency ?? null,
            specials,
            mealPlan: sampleRate.mealPlan ?? sampleRate.includedMeal?.mealName ?? null,
            includedMealsCount: ensureArray(sampleRate.includedMeals).length,
            cancellationRulesCount: ensureArray(sampleRate.cancellationRules).length,
            cancellationSample,
          }
          : null,
      });
    }
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
            specials:
              rateBasis.specials ??
              rateBasis.promotionSummary ??
              rateBasis.specialPromotions ??
              null,
            promotionSummary:
              rateBasis.promotionSummary ??
              rateBasis.specialPromotions ??
              rateBasis.specials ??
              null,
            specialPromotions:
              rateBasis.specialPromotions ??
              rateBasis.promotionSummary ??
              rateBasis.specials ??
              null,
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
      user_id: userId,
      status: FLOW_STATUSES.STARTED,
      search_context: {
        hotelId: hotel.id ?? resolvedHotelCode,
        fromDate,
        toDate,
        currency: normalizeCurrency(currency),
        rooms,
        rateBasis: normalizeRateBasis(rateBasis),
        passengerNationality: ensureNumericCode(passengerNationality, defaultCountryCode),
        passengerCountryOfResidence: ensureNumericCode(passengerCountryOfResidence, defaultCountryCode),
        cityCode: cityCode ?? null,
      },
    });
    console.info("[flows] started", { flowId });

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

    const responsePayload = attachOfferTokensToRooms(mapped, offers);
    return { flowId, offers, flow: serializeFlow(flow), ...responsePayload };
  }
  async select({ body, req }) {
    const { flowId, offerToken } = body || {};
    if (!flowId || !offerToken) {
      throw Object.assign(new Error("flowId and offerToken are required"), { status: 400 });
    }
    const flow = await requireFlowAccess({ flowId, user: req?.user });
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

    const flow = await requireFlowAccess({ flowId, user: req?.user });
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
      logMeta: { flowId },
    });
    const mapped = mapGetRoomsResponse(result);
    const rateBasis = findRateBasisMatch(mapped?.hotel, flow.selected_offer);
    const allocationIn = flow.allocation_current;
    const newAllocation = getText(rateBasis?.allocationDetails) || allocationIn;

    const updatedOffer = {
      ...flow.selected_offer,
      validForOccupancy: rateBasis?.validForOccupancy ?? flow.selected_offer.validForOccupancy ?? null,
      validForOccupancyDetails:
        rateBasis?.validForOccupancyDetails ?? flow.selected_offer.validForOccupancyDetails ?? null,
      changedOccupancy: rateBasis?.changedOccupancy ?? flow.selected_offer.changedOccupancy ?? null,
      changedOccupancyValue:
        rateBasis?.changedOccupancyValue ?? flow.selected_offer.changedOccupancyValue ?? null,
      changedOccupancyText:
        rateBasis?.changedOccupancyText ?? flow.selected_offer.changedOccupancyText ?? null,
    };

    flow.selected_offer = updatedOffer;
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

    const blockedRate = rateBasis ? { ...rateBasis } : null;
    return {
      flow: serializeFlow(flow),
      blockedRate,
      responseCurrency: mapped?.currency ?? mapped?.currencyShort ?? null,
    };
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
      customerReference: customerReferenceRaw,
    } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await requireFlowAccess({ flowId, user: req?.user });
    if (!flow.selected_offer) {
      throw Object.assign(new Error("Offer not selected for this flow"), { status: 400 });
    }

    const reusedStep = await resolveIdempotentStep(flowId, "SAVEBOOKING", idempotencyKey);
    if (reusedStep) return { flow: serializeFlow(flow), idempotent: true };

    const context = flow.search_context || {};
    const roomsPayload = parseRoomArray(roomsOverride || context.rooms);
    const parseChangedOccupancy = (value) => {
      if (!value) return null;
      const text = String(value).trim();
      if (!text) return null;
      const [adultsRaw, childrenRaw, agesRaw, extraBedRaw] = text.split(",");
      const adults = toNumberSafe(adultsRaw);
      const children = toNumberSafe(childrenRaw);
      const childrenAges = agesRaw
        ? agesRaw
          .split("_")
          .map((age) => toNumberSafe(age))
          .filter((age) => Number.isFinite(age))
        : null;
      const extraBed = toNumberSafe(extraBedRaw);
      const details = {
        adults,
        children,
        childrenAges,
        extraBed,
      };
      const cleaned = Object.fromEntries(
        Object.entries(details).filter(([, val]) => val !== null && val !== undefined),
      );
      return Object.keys(cleaned).length ? cleaned : null;
    };

    const parsedChangedOccupancy = parseChangedOccupancy(
      flow.selected_offer?.changedOccupancyValue,
    );
    const occupancyOverride =
      parsedChangedOccupancy ?? flow.selected_offer?.validForOccupancyDetails;
    const hasChangedOccupancy =
      Boolean(flow.selected_offer?.changedOccupancy) ||
      Boolean(parsedChangedOccupancy) ||
      Boolean(occupancyOverride);

    const resolveChildrenAges = (roomChildren, override) => {
      if (!override) return roomChildren;
      if (Array.isArray(override.childrenAges) && override.childrenAges.length) {
        return override.childrenAges;
      }
      if (Number.isFinite(override.children)) {
        const targetCount = Math.max(0, override.children);
        const slice = roomChildren.slice(0, targetCount);
        if (slice.length < targetCount) {
          const filler = Array.from({ length: targetCount - slice.length }, () => 8);
          return [...slice, ...filler];
        }
        return slice;
      }
      return roomChildren;
    };

    const roomsForSave = roomsPayload.map((room, idx) => {
      // Use the ORIGINAL search context for Actual adults/children
      // This preserves "1 Adult + 1 Child" even if we are billing "2 Adults"
      const originalContextRoom = context.rooms?.[idx] || room;
      const originalAdults = Math.max(1, Number(originalContextRoom.adults) || 1);
      const originalChildren = ensureArray(originalContextRoom.children).map((age) => Number(age)).filter((age) => !Number.isNaN(age));

      const billingAdults = Math.max(1, Number(room.adults) || 1);
      const billingChildren = ensureArray(room.children).map((age) => Number(age));

      // AdultsCode/Children = Billing Occupancy (from payload or override)
      const adjustedAdults =
        hasChangedOccupancy && Number.isFinite(occupancyOverride?.adults)
          ? Math.max(1, Number(occupancyOverride.adults))
          : billingAdults;

      const adjustedChildren = hasChangedOccupancy
        ? resolveChildrenAges(billingChildren, occupancyOverride)
        : billingChildren;

      const adjustedExtraBed =
        hasChangedOccupancy && occupancyOverride?.extraBed != null
          ? Number(occupancyOverride.extraBed) || 0
          : room.extraBed;

      // Actual = Original Search
      const actualAdults = originalAdults;
      const actualChildren = originalChildren;

      return {
        ...room,
        roomTypeCode: flow.selected_offer.roomTypeCode,
        selectedRateBasis: flow.selected_offer.rateBasisId,
        allocationDetails: flow.allocation_current,
        adults: adjustedAdults,
        children: adjustedChildren,
        extraBed: adjustedExtraBed,
        actualAdults,
        actualChildren,
      };
    });

    const customerReferenceRawValue =
      customerReferenceRaw ??
      body?.customer_reference ??
      null;
    const customerReferenceNormalized =
      customerReferenceRawValue == null
        ? ""
        : String(customerReferenceRawValue).trim();
    const customerReference =
      customerReferenceNormalized || `FLOW-${flowId}`;

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
      customerReference,
    });

    const { result, requestXml, responseXml, metadata } = await this.client.send("savebooking", payload, {
      requestId: getRequestId(req),
      logMeta: { flowId },
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
    const flow = await requireFlowAccess({ flowId, user: req?.user });
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

    let result;
    let requestXml;
    let responseXml;
    let metadata;
    const maxAttempts = Math.max(1, Number(process.env.WEBBEDS_PRICE_RETRY_MAX || 3));
    const baseDelayMs = Number(process.env.WEBBEDS_PRICE_RETRY_BASE_MS || 600);
    const maxDelayMs = Number(process.env.WEBBEDS_PRICE_RETRY_MAX_MS || 5000);
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        ({ result, requestXml, responseXml, metadata } = await this.client.send(
          "bookitinerary",
          payload,
          { requestId: getRequestId(req), productOverride: null, logMeta: { flowId } },
        ));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const retryable = isRetryablePriceError(error);
        const shouldRetry = retryable && attempt < maxAttempts;
        console.warn("[flows] price attempt failed", {
          flowId,
          attempt,
          retryable,
          code: error?.code ?? error?.httpStatus ?? error?.name ?? null,
          details: error?.details ?? error?.message ?? null,
        });
        if (!shouldRetry) break;
        await sleep(getRetryDelayMs(attempt, baseDelayMs, maxDelayMs));
      }
    }
    if (lastError) {
      await logStep({
        flowId,
        step: "BOOK_NO",
        command: STEP_COMMAND.BOOK_NO,
        tid: lastError?.metadata?.transactionId,
        success: false,
        errorClass: lastError?.name,
        errorCode: lastError?.code ?? lastError?.httpStatus,
        allocationIn: flow.allocation_current,
        requestXml: lastError?.requestXml,
        responseXml: lastError?.responseXml,
        idempotencyKey,
      });
      throw lastError;
    }
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
    const baseCurrency =
      mapped.currencyShort ?? flow.search_context?.currency ?? flow.pricing_snapshot_priced?.currency ?? null;
    flow.pricing_snapshot_priced = {
      currency: baseCurrency,
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

    const requestedCurrency = body?.currency ? String(body.currency).trim().toUpperCase() : null;
    const targetCurrency = requestedCurrency ? await resolveEnabledCurrency(requestedCurrency) : null;
    const priceUsd = flow.pricing_snapshot_priced?.price;
    const baseCurrencyNormalized = baseCurrency ? String(baseCurrency).toUpperCase() : null;
    const baseIsUsd =
      baseCurrencyNormalized === "USD" ||
      baseCurrencyNormalized === "840" ||
      baseCurrencyNormalized === "520";
    logCurrencyDebug("flows.price.input", {
      flowId,
      priceUsd,
      baseCurrency: baseCurrencyNormalized,
      requestedCurrency,
      resolvedCurrency: targetCurrency,
      baseIsUsd,
      hasPrice: Number.isFinite(priceUsd),
    });
    if (
      targetCurrency &&
      baseIsUsd &&
      Number.isFinite(priceUsd) &&
      priceUsd > 0
    ) {
      try {
        const ttlSeconds = Number(process.env.FX_QUOTE_TTL_SECONDS || 900);
        const now = Date.now();
        const fx = await convertCurrency(priceUsd, targetCurrency);
        flow.pricing_snapshot_priced.fxQuote = {
          baseCurrency: "USD",
          targetCurrency: fx.currency,
          rate: fx.rate,
          amount: fx.amount,
          source: fx.source || null,
          rateDate: fx.rateDate || null,
          expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
        };
        logCurrencyDebug("flows.price.fxQuote", {
          flowId,
          fxQuote: flow.pricing_snapshot_priced.fxQuote,
        });
      } catch (error) {
        console.warn("[flows] FX quote failed", error?.message || error);
      }
    }
    flow.status = FLOW_STATUSES.PRICED;
    await flow.save();

    logCurrencyDebug("flows.price.output", {
      flowId,
      pricing: flow.pricing_snapshot_priced,
    });

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
    const { flowId, paymentIntentId } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await requireFlowAccess({ flowId, user: req?.user });
    if (!flow.itinerary_booking_code) {
      throw Object.assign(new Error("Flow is missing itinerary booking code"), { status: 400 });
    }
    if (!flow.allocation_current) {
      throw Object.assign(new Error("Flow is missing allocation details"), { status: 400 });
    }

    const priceValue =
      flow.pricing_snapshot_priced?.price ??
      flow.pricing_snapshot_preauth?.price ??
      null;
    if (priceValue == null) {
      throw Object.assign(new Error("Missing amount for preauthorization"), { status: 400 });
    }
    if (body?.amount != null) {
      const clientAmount = Number(body.amount);
      const serverAmount = Number(priceValue);
      if (
        Number.isFinite(clientAmount) &&
        Number.isFinite(serverAmount) &&
        Math.abs(clientAmount - serverAmount) > 0.01
      ) {
        console.warn("[flows] preauth client amount mismatch", {
          flowId,
          clientAmount,
          serverAmount,
        });
      }
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

    const communicationEmail =
      body?.sendCommunicationTo ||
      process.env.WEBBEDS_COMM_EMAIL ||
      process.env.WEBBEDS_CC_EMAIL ||
      undefined;

    const avsDetails = {
      avsFirstName: process.env.WEBBEDS_AVS_FIRSTNAME || process.env.WEBBEDS_CC_NAME || "Guest",
      avsLastName: process.env.WEBBEDS_AVS_LASTNAME || process.env.WEBBEDS_CC_SURNAME || "User",
      avsAddress:
        process.env.WEBBEDS_AVS_ADDRESS || process.env.WEBBEDS_CC_ADDRESS || "Unknown address",
      avsZip: process.env.WEBBEDS_AVS_ZIP || "00000",
      avsCountry: process.env.WEBBEDS_AVS_COUNTRY || process.env.WEBBEDS_CC_COUNTRY || "US",
      avsCity: process.env.WEBBEDS_AVS_CITY || "Unknown city",
      avsEmail: process.env.WEBBEDS_AVS_EMAIL || process.env.WEBBEDS_CC_EMAIL || "unknown@example.com",
      avsPhone: process.env.WEBBEDS_AVS_PHONE || "+10000000000",
    };

    const payload = buildBookItineraryPayload({
      bookingCode: flow.itinerary_booking_code,
      bookingType: 2,
      confirm: "preauth",
      sendCommunicationTo: communicationEmail,
      payment: {
        paymentMethod,
        usedCredit: 0,
        creditCardCharge: priceValue,
        token,
        cardHolderName: process.env.WEBBEDS_CC_NAME,
        creditCardType: process.env.WEBBEDS_CC_TYPE || 100,
        avsDetails,
        authorisationId: paymentIntentId,
        devicePayload: process.env.WEBBEDS_DEVICE_PAYLOAD || "static-device",
        endUserIPAddress: process.env.WEBBEDS_DEFAULT_IP || "127.0.0.1",
      },
      services,
    });

    let result;
    let requestXml;
    let responseXml;
    let metadata;
    try {
      ({ result, requestXml, responseXml, metadata } = await this.client.send(
        "bookitinerary",
        payload,
        { requestId: getRequestId(req), productOverride: null, logMeta: { flowId } },
      ));
    } catch (error) {
      await logStep({
        flowId,
        step: "PREAUTH",
        command: STEP_COMMAND.PREAUTH,
        tid: error?.metadata?.transactionId,
        success: false,
        errorClass: error?.name,
        errorCode: error?.code ?? error?.httpStatus,
        allocationIn: flow.allocation_current,
        requestXml: error?.requestXml,
        responseXml: error?.responseXml,
        idempotencyKey,
      });
      throw error;
    }
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
  async recheckAvailability({ flow, req, idempotencyKey }) {
    const context = flow?.search_context || {};
    if (!flow?.selected_offer) {
      throw Object.assign(new Error("Offer not selected for this flow"), { status: 400 });
    }

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

    let result;
    let requestXml;
    let responseXml;
    let metadata;
    const allocationIn = flow.allocation_current;
    try {
      ({ result, requestXml, responseXml, metadata } = await this.client.send(
        "getrooms",
        payload,
        { requestId: getRequestId(req), productOverride: "hotel", logMeta: { flowId: flow.id } },
      ));
    } catch (error) {
      await logStep({
        flowId: flow.id,
        step: "RECHECK",
        command: STEP_COMMAND.GETROOMS,
        tid: error?.metadata?.transactionId,
        success: false,
        errorClass: error?.name,
        errorCode: error?.code ?? error?.httpStatus,
        allocationIn,
        requestXml: error?.requestXml,
        responseXml: error?.responseXml,
        idempotencyKey,
      });
      throw error;
    }

    const mapped = mapGetRoomsResponse(result);
    const rooms = ensureArray(mapped?.hotel?.rooms);
    const rateBasis = findRateBasisMatch(mapped?.hotel, flow.selected_offer);
    if (!rooms.length || !rateBasis) {
      const error = buildNoAvailabilityError({
        message: "Selected rate is no longer available.",
        requestXml,
        responseXml,
        metadata,
      });
      await logStep({
        flowId: flow.id,
        step: "RECHECK",
        command: STEP_COMMAND.GETROOMS,
        tid: metadata?.transactionId,
        success: false,
        errorClass: error?.name,
        errorCode: error?.code,
        allocationIn,
        requestXml,
        responseXml,
        idempotencyKey,
      });
      throw error;
    }

    const newAllocation = getText(rateBasis?.allocationDetails) || allocationIn;
    if (newAllocation && newAllocation !== allocationIn) {
      flow.allocation_current = newAllocation;
      await flow.save();
    }

    await logStep({
      flowId: flow.id,
      step: "RECHECK",
      command: STEP_COMMAND.GETROOMS,
      tid: metadata?.transactionId,
      success: true,
      allocationIn,
      allocationOut: newAllocation,
      requestXml,
      responseXml,
      idempotencyKey,
    });

    return { allocationIn, allocationOut: newAllocation };
  }
  async confirm({ body, req }) {
    const { flowId } = body || {};
    const idempotencyKey = body?.idempotencyKey || req?.headers?.["idempotency-key"];
    if (!flowId) throw Object.assign(new Error("flowId is required"), { status: 400 });
    const flow = await requireFlowAccess({ flowId, user: req?.user });
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
      bookingType: 2,
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
      { requestId: getRequestId(req), productOverride: null, logMeta: { flowId } },
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
      voucher: booking?.voucher ?? null,
      totalTaxes: booking?.totalTaxes ?? null,
      totalFee: booking?.totalFee ?? null,
      currency: booking?.currency ?? mapped.currencyShort ?? flow.pricing_snapshot_preauth?.currency ?? null,
      servicePrice: booking?.servicePrice ?? booking?.price ?? null,
      paymentGuaranteedBy: booking?.paymentGuaranteedBy ?? null,
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
    const flow = await requireFlowAccess({ flowId, user: req?.user });
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
      { requestId: getRequestId(req), productOverride: null, logMeta: { flowId } },
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
    const flow = await requireFlowAccess({ flowId, user: req?.user });
    const bookingCode = flow.final_booking_code || flow.itinerary_booking_code;
    if (!bookingCode) {
      throw Object.assign(new Error("Flow missing booking code for cancellation"), { status: 400 });
    }

    const penalty =
      flow.cancel_quote_snapshot?.services?.[0]?.cancellationPenalties?.[0] ?? null;
    const penaltyApplied = penalty?.charge ?? penalty?.penaltyApplied ?? null;
    const paidAmount =
      flow.pricing_snapshot_confirmed?.price ??
      flow.pricing_snapshot_preauth?.price ??
      flow.pricing_snapshot_priced?.price ??
      null;
    const paymentBalance =
      penaltyApplied != null && paidAmount != null
        ? Math.max(0, Number(paidAmount) - Number(penaltyApplied))
        : paidAmount ?? null;

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
      { requestId: getRequestId(req), productOverride: null, logMeta: { flowId } },
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
  async getFlow(flowId, { user } = {}) {
    const flow = await requireFlowAccess({ flowId, user });
    return serializeFlow(flow);
  }

  async getSteps(flowId, { includeXml = false, user } = {}) {
    await requireFlowAccess({ flowId, user });
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
