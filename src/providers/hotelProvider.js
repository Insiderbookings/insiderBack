// src/providers/hotelProvider.js
export class HotelProvider {
  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async listHotels(req, res, next) {
    throw new Error("listHotels not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async search(req, res, next) {
    throw new Error("search not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async getCategories(req, res, next) {
    throw new Error("getCategories not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async getDestinations(req, res, next) {
    throw new Error("getDestinations not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async getRooms(req, res, next) {
    throw new Error("getRooms not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async getBoards(req, res, next) {
    throw new Error("getBoards not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async getMetadata(req, res, next) {
    throw new Error("getMetadata not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async quote(req, res, next) {
    throw new Error("quote not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async book(req, res, next) {
    throw new Error("book not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async cancel(req, res, next) {
    throw new Error("cancel not implemented");
  }

  /**
   * @param {import("express").Request} req
   * @param {import("express").Response} res
   * @param {Function} next
   */
  async readBooking(req, res, next) {
    throw new Error("readBooking not implemented");
  }
}
