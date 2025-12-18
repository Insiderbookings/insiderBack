
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

export const buildDeleteItineraryPayload = ({ bookingId, bookingCode, bookingType, confirm = "yes", reason } = {}) => {
    const code = bookingCode || bookingId
    if (!code) {
        throw new Error("WebBeds deleteitinerary requires bookingCode (or bookingId)")
    }

    // bookingType: 1=Confirmed, 2=Saved. Default to 2 (Saved) for deletions
    const bType = bookingType ? String(bookingType) : "2"

    const payload = {
        bookingDetails: {
            bookingType: bType,
            bookingCode: String(code),
            confirm: String(confirm),
        },
    }

    if (reason) {
        payload.comment = reason
    }

    return payload
}


const ensureArray = (value) => {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

const toText = (value) => {
    if (value == null) return null
    if (typeof value === "string" || typeof value === "number") return String(value)
    if (typeof value === "object") {
        return value["#"] ?? value["#text"] ?? value.text ?? value.formatted ?? value.value ?? null
    }
    return null
}

export const mapDeleteItineraryResponse = (result) => {
    const services = ensureArray(result?.services?.service).map((svc) => ({
        runno: svc?.["@_runno"],
        code: svc?.["@_code"],
        cancellationPenalties: ensureArray(svc?.cancellationPenalty).map((penalty) => ({
            charge: toText(penalty?.charge) ?? toText(penalty?.penaltyApplied),
            chargeFormatted: penalty?.charge?.formatted ?? penalty?.penaltyApplied?.formatted,
            currency: penalty?.currency,
            currencyShort: penalty?.currencyShort,
        }))
    }))

    return {
        successful: normalizeBoolean(result?.successful),
        productsLeftOnItinerary: toNumber(result?.productsLeftOnItinerary),
        currencyShort: result?.currencyShort ?? null,
        services,
        metadata: {
            command: result?.["@_command"] ?? null,
            transactionId: result?.["@_tID"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
        },
    }
}
