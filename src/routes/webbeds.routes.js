import { Router } from "express"
import rateLimit from "express-rate-limit"
import {
  listStaticHotels,
  listExploreHotels,
  listExploreCollections,
  search,
  getRooms,
  listCountries,
  listCities,
  listRateBasis,
  listHotelAmenities,
  listRoomAmenities,
  listHotelChains,
  listHotelClassifications,
  listSalutationsCatalog,
  proxyWebbedsImage,
  getBookingDetails,
  createPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  getMerchantPaymentContext,
  setMerchantPaymentContext,
  clearMerchantPaymentContext,
} from "../controllers/webbeds.controller.js"
import { authenticate, authorizeRoles } from "../middleware/auth.js"

const router = Router()
const PROVIDER_RATE_WINDOW_MS = 15 * 60 * 1000
const PROVIDER_READ_LIMIT_MAX = Math.max(20, Number(process.env.PROVIDER1_READ_RATE_LIMIT_MAX || 120))
const PROVIDER_WRITE_LIMIT_MAX = Math.max(5, Number(process.env.PROVIDER1_WRITE_RATE_LIMIT_MAX || 30))
const providerReadLimiter = rateLimit({
  windowMs: PROVIDER_RATE_WINDOW_MS,
  max: PROVIDER_READ_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many provider requests. Please slow down." },
})
const providerWriteLimiter = rateLimit({
  windowMs: PROVIDER_RATE_WINDOW_MS,
  max: PROVIDER_WRITE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many provider write attempts. Please wait and retry." },
})

router.get("/search", providerReadLimiter, authenticate, search)
router.get("/rooms", providerReadLimiter, authenticate, getRooms)
router.post("/create-payment-intent", providerWriteLimiter, authenticate, createPaymentIntent)
router.post("/capture-payment-intent", providerWriteLimiter, authenticate, capturePaymentIntent)
router.post("/cancel-payment-intent", providerWriteLimiter, authenticate, cancelPaymentIntent)
router.get("/payment-context/merchant", authenticate, authorizeRoles(100), getMerchantPaymentContext)
router.post("/payment-context/merchant", authenticate, authorizeRoles(100), setMerchantPaymentContext)
router.delete("/payment-context/merchant", authenticate, authorizeRoles(100), clearMerchantPaymentContext)
router.get("/booking", providerReadLimiter, authenticate, getBookingDetails)
router.get("/static/hotels", listStaticHotels)
router.get("/explore", listExploreHotels)
router.get("/explore/collections", listExploreCollections)
router.get("/image", proxyWebbedsImage)
router.get("/countries", listCountries)
router.get("/cities", providerReadLimiter, authenticate, listCities)
router.get("/ratebasis", providerReadLimiter, authenticate, listRateBasis)
router.get("/amenities", providerReadLimiter, authenticate, listHotelAmenities)
router.get("/room-amenities", providerReadLimiter, authenticate, listRoomAmenities)
router.get("/chains", providerReadLimiter, authenticate, listHotelChains)
router.get("/classifications", providerReadLimiter, authenticate, listHotelClassifications)
router.get("/salutations", providerReadLimiter, authenticate, listSalutationsCatalog)

export default router
