import { Router } from "express"
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
} from "../controllers/webbeds.controller.js"
import { authenticate } from "../middleware/auth.js"

const router = Router()

router.get("/search", authenticate, search)
router.get("/rooms", authenticate, getRooms)
router.post("/create-payment-intent", authenticate, createPaymentIntent)
router.post("/capture-payment-intent", authenticate, capturePaymentIntent)
router.post("/cancel-payment-intent", authenticate, cancelPaymentIntent)
router.get("/booking", authenticate, getBookingDetails)
router.get("/static/hotels", listStaticHotels)
router.get("/explore", listExploreHotels)
router.get("/explore/collections", listExploreCollections)
router.get("/image", proxyWebbedsImage)
router.get("/countries", listCountries)
router.get("/cities", authenticate, listCities)
router.get("/ratebasis", authenticate, listRateBasis)
router.get("/amenities", authenticate, listHotelAmenities)
router.get("/room-amenities", authenticate, listRoomAmenities)
router.get("/chains", authenticate, listHotelChains)
router.get("/classifications", authenticate, listHotelClassifications)
router.get("/salutations", authenticate, listSalutationsCatalog)

export default router
