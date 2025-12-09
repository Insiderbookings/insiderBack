
const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        return ["1", "true", "yes", "y"].includes(normalized)
    }
    return false
}

// Reuse logic from saveBooking or searchHotels if we need deep parsing of rooms/pax
// For now we implement basic details mapping relevant for status checks

const ensureArray = (value) => {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

export const buildGetBookingDetailsPayload = ({ bookingId } = {}) => {
    if (!bookingId) {
        throw new Error("WebBeds getbookingdetails requires bookingId")
    }

    return {
        bookingDetails: {
            bookingId: String(bookingId),
        },
    }
}

export const mapGetBookingDetailsResponse = (result) => {
    const bookingDetails = result?.bookingDetails ?? {}
    const roomsNode = ensureArray(bookingDetails.rooms?.room)

    const rooms = roomsNode.map(room => ({
        runno: room?.["@_runno"],
        status: room?.status,
        confirmationNo: room?.confirmationNo,
        paxNames: ensureArray(room?.paxDetails?.pax).map(p => p?.name).filter(Boolean)
    }))

    return {
        successful: normalizeBoolean(result?.successful),
        bookingId: bookingDetails.bookingId ?? null,
        status: bookingDetails.status ?? null,
        bookingDate: bookingDetails.bookingDate ?? null,
        currency: bookingDetails.currency ?? null,
        totalPrice: bookingDetails.totalPrice ?? null,
        voucher: bookingDetails.voucher ?? null,
        reference: bookingDetails.reference ?? null,
        rooms,
        metadata: {
            command: result?.["@_command"] ?? null,
            date: result?.["@_date"] ?? null,
        },
    }
}
