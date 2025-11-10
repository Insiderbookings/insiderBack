import { HotelProvider } from "../hotelProvider.js"
import { listHotels } from "./listHotels.js"
import { search } from "./search.js"
import { getCategories } from "./getCategories.js"
import { getDestinations } from "./getDestinations.js"
import { getRooms } from "./getRooms.js"
import { getBoards } from "./getBoards.js"
import { getMetadata } from "./getMetadata.js"
import { quote } from "./quote.js"
import { book } from "./book.js"
import { cancel } from "./cancel.js"
import { readBooking } from "./readBooking.js"

export class TravelgateProvider extends HotelProvider {
  async listHotels(req, res, next) {
    return listHotels(req, res, next)
  }

  async search(req, res, next) {
    return search(req, res, next)
  }

  async getCategories(req, res, next) {
    return getCategories(req, res, next)
  }

  async getDestinations(req, res, next) {
    return getDestinations(req, res, next)
  }

  async getRooms(req, res, next) {
    return getRooms(req, res, next)
  }

  async getBoards(req, res, next) {
    return getBoards(req, res, next)
  }

  async getMetadata(req, res, next) {
    return getMetadata(req, res, next)
  }

  async quote(req, res, next) {
    return quote(req, res, next)
  }

  async book(req, res, next) {
    return book(req, res, next)
  }

  async cancel(req, res, next) {
    return cancel(req, res, next)
  }

  async readBooking(req, res, next) {
    return readBooking(req, res, next)
  }
}




