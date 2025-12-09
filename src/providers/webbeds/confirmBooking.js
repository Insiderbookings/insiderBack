import { WebbedsError } from "./client.js"

const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        return ["1", "true", "yes", "y"].includes(normalized)
    }
    return false
}

export const buildConfirmBookingPayload = ({ bookingId } = {}) => {
    if (!bookingId) {
        throw new Error("WebBeds confirmbooking requires bookingId")
    }

    return {
        bookingDetails: {
            bookingId: String(bookingId),
        },
    }
}

export const mapConfirmBookingResponse = (result) => {
    const bookingDetails = result?.bookingDetails ?? {}

    return {
        successful: normalizeBoolean(result?.successful),
        bookingId: bookingDetails.bookingId ?? null,
        status: bookingDetails.status ?? null,
        voucher: bookingDetails.voucher ?? null,
        reference: bookingDetails.reference ?? null,
        currency: bookingDetails.currency ?? null,
        totalPrice: bookingDetails.totalPrice ?? null,
        metadata: {
            command: result?.["@_command"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
            time: result?.["@_time"] ?? null,
            version: result?.["@_version"] ?? null,
        },
    }
}
