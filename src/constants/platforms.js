export const PLATFORM_STATUS = ["pending", "in_review", "approved", "rejected"];

export const PLATFORM_DEFAULTS = [
  { name: "Booking.com", slug: "booking", requiresFaceVerification: false },
  { name: "Expedia", slug: "expedia", requiresFaceVerification: false },
  { name: "Agoda", slug: "agoda", requiresFaceVerification: false },
  { name: "Vrbo", slug: "vrbo", requiresFaceVerification: true },
  { name: "Airbnb", slug: "airbnb", requiresFaceVerification: true },
];
