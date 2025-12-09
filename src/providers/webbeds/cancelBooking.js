
const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        return ["1", "true", "yes", "y"].includes(normalized)
    }
    return false
}

const toNumber = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

export const buildCancelBookingPayload = ({ bookingId, reason } = {}) => {
    if (!bookingId) {
        throw new Error("WebBeds cancelbooking requires bookingId")
    }

    const payload = {
        bookingDetails: {
            bookingId: String(bookingId),
        },
    }

    if (reason) {
        payload.comment = {
            "#": reason
        }
    }

    return payload
}

export const mapCancelBookingResponse = (result) => {
    const bookingDetails = result?.bookingDetails ?? {}

    return {
        successful: normalizeBoolean(result?.successful),
        bookingId: bookingDetails.bookingId ?? null,
        status: bookingDetails.status ?? null,
        cancellationCharge: toNumber(bookingDetails.cancellationCharge),
        currency: bookingDetails.currency ?? null,
        metadata: {
            command: result?.["@_command"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
        },
    }
}
