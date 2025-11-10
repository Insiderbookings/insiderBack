import { readBookingTGX } from "./services/bookingRead.service.js"

export const readBooking = async (req, res, next) => {
  try {
    const {
      bookingID,
      accessCode,         // opcional (si viene, lo pasamos a fetchHotels)
      reference = {},     // { client?, supplier?, hotel? }
      hotelCode,          // alias (no lo usamos para content; el real viene del reading)
      hotel,              // alias
      currency,           // opcional
      language,           // opcional para bookingRead (NO para hotels)
      start,
      end,
    } = req.body || {}

    // --- Validaciones mínimas: ID, REFS o DATES ---
    const hasId    = typeof bookingID === "string" && bookingID.trim().length > 0
    const hasRefs  = !!accessCode && (reference.client || reference.supplier)
    const hasDates = !!accessCode && !!start && !!end
    if (!hasId && !hasRefs && !hasDates) {
      return res.status(400).json({
        error: "bookingID o (accessCode+references) o (accessCode+start/end) requeridos"
      })
    }

    // --- Criteria que entiende el service de booking read ---
    const criteria = hasId
      ? { bookingID: bookingID.trim() }
      : {
          ...(hasRefs ? {
            accessCode: String(accessCode),
            reference: {
              ...(reference.client   ? { client:   String(reference.client) }   : {}),
              ...(reference.supplier ? { supplier: String(reference.supplier) } : {}),
              ...(reference.hotel    ? { hotel:    String(reference.hotel) }    : {}),
            },
            ...(hotelCode ? { hotelCode: String(hotelCode) } : (hotel ? { hotel: String(hotel) } : {})),
            ...(currency  ? { currency:  String(currency).toUpperCase() } : {}),
            ...(language  ? { language } : {}), // OK aquí
          } : {}),
          ...(hasDates ? { accessCode: String(accessCode), start, end, ...(language ? { language } : {}) } : {}),
        }

    const settings = {
      client:   process.env.TGX_CLIENT,
      context:  process.env.TGX_CONTEXT,
      timeout:  60000,
      testMode: process.env.NODE_ENV !== "production",
    }

    // 1) Leer la/s reserva/s
    const read = await readBookingTGX(criteria, settings)
    const bookings = Array.isArray(read.bookings) ? read.bookings : []

    if (bookings.length === 0) {
      return res.json(read)
    }

    // 2) Recolectar hotelCodes **desde la respuesta de TGX** (no del body)
    const uniqueCodes = [
      ...new Set(
        bookings
          .map(b => String(b?.hotel?.hotelCode || "").trim())
          .filter(Boolean)
      )
    ]

    if (uniqueCodes.length === 0) {
      // No hay códigos para enriquecer
      return res.json(read)
    }

    // 3) Traer content de hotel con tu service (¡array plano! y sin language)
    const hotelcriteria = {
            access: 2,                    // número
            hotelCodes: uniqueCodes,   // string[]
            maxSize: 1
        }

        const page = await fetchHotels(hotelcriteria, "")
        const edge = page?.edges?.[0]
        const hotelData = edge?.node?.hotelData


    // 5) Mezclar detalles de hotel en cada booking
    const enriched = {
      ...read,
      hotelData
    }

    return res.json(enriched)
  } catch (err) {
    next(err)
  }
}



