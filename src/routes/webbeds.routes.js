import { Router } from "express"
import {
  listStaticHotels,
  search,
  getRooms,
  saveBooking,
  listCountries,
  listCities,
  listRateBasis,
  listHotelAmenities,
  listRoomAmenities,
  listHotelChains,
  listHotelClassifications,
  confirmBooking,
  bookItineraryRecheck,
  bookItineraryPreauth,
  bookItinerary,
  cancelBooking,
  deleteItinerary,
  getBookingDetails,
  createPaymentIntent,
} from "../controllers/webbeds.controller.js"
import { authenticate, requireVerifiedEmail } from "../middleware/auth.js"

const router = Router()

router.get("/search", authenticate, search)
router.get("/rooms", authenticate, getRooms)
router.post("/create-payment-intent", authenticate, createPaymentIntent)
router.post("/savebooking", authenticate, requireVerifiedEmail, saveBooking)
router.post("/bookitinerary", authenticate, requireVerifiedEmail, bookItinerary)
router.post("/bookitinerary/recheck", authenticate, requireVerifiedEmail, bookItineraryRecheck)
router.post("/bookitinerary/preauth", authenticate, requireVerifiedEmail, bookItineraryPreauth)
router.post("/confirmbooking", authenticate, requireVerifiedEmail, confirmBooking)
router.post("/cancelbooking", authenticate, cancelBooking)
router.post("/deleteitinerary", authenticate, deleteItinerary)
router.get("/booking", authenticate, getBookingDetails)
router.get("/static/hotels", authenticate, listStaticHotels)
router.get("/countries", authenticate, listCountries)
router.get("/cities", authenticate, listCities)
router.get("/ratebasis", authenticate, listRateBasis)
router.get("/amenities", authenticate, listHotelAmenities)
router.get("/room-amenities", authenticate, listRoomAmenities)
router.get("/chains", authenticate, listHotelChains)
router.get("/classifications", authenticate, listHotelClassifications)

export default router
