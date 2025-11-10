// src/controllers/travelgate.controller.js
import { TravelgateProvider } from "../providers/travelgate/provider.js"

const provider = new TravelgateProvider()

export const listHotels = (req, res, next) => provider.listHotels(req, res, next)
export const search = (req, res, next) => provider.search(req, res, next)
export const getCategories = (req, res, next) => provider.getCategories(req, res, next)
export const getDestinations = (req, res, next) => provider.getDestinations(req, res, next)
export const getRooms = (req, res, next) => provider.getRooms(req, res, next)
export const getBoards = (req, res, next) => provider.getBoards(req, res, next)
export const getMetadata = (req, res, next) => provider.getMetadata(req, res, next)
export const quote = (req, res, next) => provider.quote(req, res, next)
export const book = (req, res, next) => provider.book(req, res, next)
export const cancel = (req, res, next) => provider.cancel(req, res, next)
export const readBooking = (req, res, next) => provider.readBooking(req, res, next)

