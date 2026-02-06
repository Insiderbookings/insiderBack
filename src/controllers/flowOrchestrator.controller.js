import FlowOrchestratorService from "../services/flowOrchestrator.service.js";
import { mapWebbedsError } from "../utils/webbedsErrorMapper.js";
import { logCurrencyDebug } from "../utils/currencyDebug.js";

const service = new FlowOrchestratorService();

const wrap = (handler) => async (req, res, next) => {
  try {
    const result = await handler(req, res, next);
    return res.json(result);
  } catch (error) {
    const isWebbedsError = error?.name === "WebbedsError";
    const status = error.status || (isWebbedsError ? 400 : 500);
    if (status >= 500) {
      console.error("[flows]", error);
    }
    const payload = { error: error.message || "Unexpected error" };
    if (isWebbedsError) {
      const mapped = mapWebbedsError(error.code, error.details);
      payload.command = error.command ?? null;
      payload.code = error.code ?? null;
      payload.details = error.details ?? null;
      payload.extraDetails = error.extraDetails ?? null;
      payload.httpStatus = error.httpStatus ?? null;
      payload.metadata = error.metadata ?? null;
      payload.errorKey = mapped.errorKey;
      payload.userMessage = mapped.userMessage;
      payload.retryable = mapped.retryable;
    }
    return res.status(status).json(payload);
  }
};

export const startFlow = wrap((req) => {
  logCurrencyDebug("flows.start.request", {
    userId: req.user?.id ?? null,
    currency: req.body?.currency ?? null,
    hotelId: req.body?.hotelId ?? req.body?.productId ?? null,
    fromDate: req.body?.fromDate ?? null,
    toDate: req.body?.toDate ?? null,
    rooms: req.body?.rooms ?? null,
    headersCurrency: req.headers?.["x-currency"] ?? null,
  });
  return service.start({ body: req.body, req });
});
export const selectFlow = wrap((req) => service.select({ body: req.body, req }));
export const blockFlow = wrap((req) => service.block({ body: req.body, req }));
export const saveBookingFlow = wrap((req) => service.saveBooking({ body: req.body, req }));
export const priceFlow = wrap((req) => service.price({ body: req.body, req }));
export const preauthFlow = wrap((req) => service.preauth({ body: req.body, req }));
export const confirmFlow = wrap((req) => service.confirm({ body: req.body, req }));
export const cancelQuoteFlow = wrap((req) => service.cancelQuote({ body: req.body, req }));
export const cancelFlow = wrap((req) => service.cancel({ body: req.body, req }));
export const getFlow = wrap((req) =>
  service.getFlow(req.params.flowId, { user: req.user })
);
export const getFlowSteps = wrap((req) =>
  service.getSteps(req.params.flowId, {
    includeXml: req.query.includeXml === "true",
    user: req.user,
  })
);
