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
  cancelBooking,
  getBookingDetails,
  createPaymentIntent,
} from "../controllers/webbeds.controller.js"

const router = Router()

router.get("/search", search)
router.get("/rooms", getRooms)
router.get("/rooms", getRooms)
router.post("/create-payment-intent", createPaymentIntent)
router.post("/savebooking", saveBooking)
router.post("/confirmbooking", confirmBooking)
router.post("/cancelbooking", cancelBooking)
router.get("/booking", getBookingDetails)
router.get("/static/hotels", listStaticHotels)
router.get("/countries", listCountries)
router.get("/cities", listCities)
router.get("/ratebasis", listRateBasis)
router.get("/amenities", listHotelAmenities)
router.get("/room-amenities", listRoomAmenities)
router.get("/chains", listHotelChains)
router.get("/classifications", listHotelClassifications)

export default router
