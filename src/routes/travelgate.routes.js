import { Router } from 'express'
import {
  book,
  readBooking,
  cancel,
  getCategories,
  getDestinations,
  listHotels,
  quote,
  search,
  getRooms,
  getBoards,
  getMetadata
} from '../controllers/travelgate.controller.js'

const router = Router()

/* ── Content endpoints ─────────────────────────── */
router.get("/getHotels", listHotels)         // lista 15 hoteles
router.get("/search", search)                // availability + prices
router.get("/categories", getCategories)     // categorías de hoteles (estrellas)
router.get("/destinations", getDestinations) // destinos (ciudades/zonas)
router.get("/rooms", getRooms)               // tipos de habitaciones
router.get("/boards", getBoards)             // planes de comida (meal plans)
router.get("/metadata", getMetadata)         // metadatos del proveedor

/* ── Booking flow ──────────────────────────────── */
router.post("/quote", quote)                 // verifica precio
router.post("/book", book)                   // confirma reserva
router.post("/booking-read", readBooking)    // lee reserva
router.post("/cancel", cancel)               // anula reserva

export default router
