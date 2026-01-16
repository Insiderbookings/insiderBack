const ERROR_DEFINITIONS = [
  {
    codes: ["0", "5", "6", "7", "23", "26"],
    key: "invalid_request",
    message: "We could not process the request. Please try again.",
    retryable: false,
  },
  {
    codes: ["3", "12", "140", "149", "120002", "120003", "1109858", "750002"],
    key: "no_availability",
    message: "Selected rate is no longer available. Please choose another.",
    retryable: false,
  },
  {
    codes: ["4", "13", "120009"],
    key: "invalid_hotel",
    message: "This hotel is not available right now. Please try another.",
    retryable: false,
  },
  {
    codes: ["8", "20", "25"],
    key: "invalid_credentials",
    message: "Service is temporarily unavailable. Please try again later.",
    retryable: true,
  },
  {
    codes: ["31"],
    key: "unrecognized_ip",
    message: "Service is temporarily unavailable. Please try again later.",
    retryable: true,
  },
  {
    codes: ["32"],
    key: "invalid_currency",
    message: "We could not process the currency for this booking.",
    retryable: false,
  },
  {
    codes: ["33", "107", "127", "131"],
    key: "invalid_dates",
    message: "The selected dates are not valid. Please choose new dates.",
    retryable: false,
  },
  {
    codes: ["67", "900", "901"],
    key: "rate_limited",
    message: "Too many requests. Please wait a moment and try again.",
    retryable: true,
  },
  {
    codes: ["53", "63", "5300", "696"],
    key: "supplier_unavailable",
    message: "We couldn't confirm this booking. No charge was made. Please try again.",
    retryable: true,
  },
  {
    codes: ["151", "152", "153", "305"],
    key: "rate_changed",
    message: "The rate or cancellation policy changed. Please review and try again.",
    retryable: false,
  },
  {
    codes: ["109"],
    key: "left_to_sell",
    message: "This room is no longer available. Please choose another.",
    retryable: false,
  },
  {
    codes: ["115", "116", "119"],
    key: "permission_denied",
    message: "Service is temporarily unavailable. Please try again later.",
    retryable: true,
  },
  {
    codes: ["117"],
    key: "session_expired",
    message: "Your booking session expired. Please try again.",
    retryable: true,
  },
  {
    codes: ["132"],
    key: "supplier_payment_error",
    message: "We couldn't process the payment with the supplier. No charge was made. Please try again.",
    retryable: true,
  },
  {
    codes: ["190"],
    key: "insufficient_limit",
    message: "We couldn't finalize this booking. Please try again later.",
    retryable: true,
  },
  {
    codes: ["210", "211", "212"],
    key: "cancellation_not_allowed",
    message: "This booking cannot be cancelled.",
    retryable: false,
  },
  {
    codes: ["302", "303", "304"],
    key: "amend_not_allowed",
    message: "This booking cannot be changed.",
    retryable: false,
  },
  {
    codes: ["65002", "86000"],
    key: "booking_failed",
    message: "Booking failed. Please try again.",
    retryable: true,
  },
];

const normalizeCode = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

export const mapWebbedsError = (code, details) => {
  const normalized = normalizeCode(code);
  const def = ERROR_DEFINITIONS.find((entry) => entry.codes.includes(normalized));
  if (def) {
    return {
      errorKey: def.key,
      userMessage: def.message,
      retryable: Boolean(def.retryable),
      code: normalized || null,
      details: details || null,
    };
  }
  return {
    errorKey: "webbeds_error",
    userMessage: "We could not complete this request. Please try again.",
    retryable: true,
    code: normalized || null,
    details: details || null,
  };
};
