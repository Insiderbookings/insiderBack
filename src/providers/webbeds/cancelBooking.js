
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

export const buildCancelBookingPayload = ({ bookingId, bookingCode, bookingType, confirm = "yes", reason, services = [] } = {}) => {
    const code = bookingCode || bookingId
    if (!code) {
        throw new Error("WebBeds cancelbooking requires bookingCode (or bookingId)")
    }

    // bookingType: 1=Confirmed, 2=Saved. Default to 1 if not provided
    const bType = bookingType ? String(bookingType) : "1"

    const payload = {
        bookingDetails: {
            bookingType: bType,
            bookingCode: String(code),
            confirm: String(confirm),
        },
    }

    // Add testPricesAndAllocation if services with penaltyApplied are provided
    // This is used in the 2-step flow: confirm=no returns charge, then confirm=yes sends penaltyApplied
    if (Array.isArray(services) && services.length > 0) {
        const referenceNumber = String(code)
        // WebBeds cancelbooking expects referencenumber to match bookingCode.
        payload.bookingDetails.testPricesAndAllocation = {
            service: services.map((svc) => ({
                "@referencenumber": referenceNumber,
                penaltyApplied: svc.penaltyApplied ?? svc.charge ?? undefined,
                paymentBalance: svc.paymentBalance ?? undefined,
            }))
        }
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

export const mapCancelBookingResponse = (result) => {
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
        services,
        metadata: {
            command: result?.["@_command"] ?? null,
            transactionId: result?.["@_tID"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
        },
    }
}
