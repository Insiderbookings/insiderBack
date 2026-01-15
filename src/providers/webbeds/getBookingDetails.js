
const normalizeBoolean = (value) => {
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase()
        return ["1", "true", "yes", "y"].includes(normalized)
    }
    return false
}

const ensureArray = (value) => {
    if (!value) return []
    return Array.isArray(value) ? value : [value]
}

const toText = (value) => {
    if (value == null) return null
    if (typeof value === "string" || typeof value === "number") return String(value)
    if (typeof value === "object") {
        return (
            value["#"] ??
            value["#text"] ??
            value.text ??
            value.formatted ??
            value.value ??
            value.amount ??
            null
        )
    }
    return null
}

const parseFormattedPrice = (node) => {
    if (!node) return null
    // Often looks like <servicePrice><formatted>123.00</formatted></servicePrice>
    // Or just direct value if fast-xml-parser simplifies it.
    return toText(node)
}

const parsePropertyFees = (node) => {
    if (!node) return []
    const fees = ensureArray(node?.propertyFee ?? node)
    return fees.map((fee) => ({
        name: fee?.["@_name"] ?? fee?.name ?? null,
        description: fee?.["@_description"] ?? fee?.description ?? null,
        includedInPrice: normalizeBoolean(
            fee?.["@_includedinprice"] ?? fee?.includedinprice ?? fee?.includedInPrice
        ),
        currency: fee?.["@_currencyshort"] ?? fee?.currencyshort ?? fee?.currency ?? null,
        amount: parseFormattedPrice(fee),
        formatted: toText(fee?.formatted ?? fee?.["#text"] ?? fee?.text ?? fee),
    }))
}

export const buildGetBookingDetailsPayload = ({ bookingId, bookingCode, bookingType } = {}) => {
    const code = bookingCode || bookingId
    if (!code) {
        throw new Error("WebBeds getbookingdetails requires bookingCode (or bookingId)")
    }

    // user spec: <bookingDetails><bookingType>...</bookingType><bookingCode>...</bookingCode></bookingDetails>
    // bookingType: 1=Confirmed, 2=Saved. Default to 1 (Confirmed) if not sure?
    // Actually, documentation says "Specifies at what stage the booking is currently".
    // Let's assume input might be provided, otherwise default to null (XML might fail if strictly required?)
    // The spec says "Yes" for Required... so we should probably default to something or require it.
    // If user passes nothing, we might guess 'confirmed' (1) as that is most useful.

    const bType = bookingType ? String(bookingType) : "1"

    return {
        bookingDetails: {
            bookingType: bType,
            bookingCode: String(code),
        },
    }
}

export const mapGetBookingDetailsResponse = (result) => {
    // Structure is <result><product>...</product><successful>...</successful></result>
    // NOT <bookingDetails> in response. The response has <product>.

    const product = result?.product ?? {}
    const successful = normalizeBoolean(result?.successful)

    // Parse cancellation rules
    const cancellationRules = ensureArray(product?.cancellationRules?.rule).map((rule) => ({
        runno: rule?.["@_runno"],
        fromDate: rule?.fromDate,
        toDate: rule?.toDate,
        charge: parseFormattedPrice(rule?.charge),
        details: {
            from: rule?.fromDateDetails,
            to: rule?.toDateDetails,
        }
    }))

    const passengers = ensureArray(product?.passengersDetails?.passenger).map((p) => ({
        leading: normalizeBoolean(p?.["@_leading"]),
        runno: p?.["@_runno"],
        salutation: p?.salutation?.["#"] ?? p?.salutation?.value ?? p?.salutation, // weird structure in spec
        firstName: p?.firstName,
        lastName: p?.lastName,
        code: p?.code
    }))

    const extraMeals = ensureArray(product?.extraMeals?.mealDate).map((md) => ({
        date: md?.["@_datetime"],
        day: md?.day,
        meals: ensureArray(md?.mealType).flatMap(mt =>
            ensureArray(mt?.meal).map(m => ({
                type: mt?.["@_mealtypename"],
                code: m?.mealCode,
                name: m?.mealName,
                price: parseFormattedPrice(m?.mealPrice),
                applicableFor: m?.["@_applicablefor"]
            }))
        )
    }))

    return {
        successful,
        metadata: {
            command: result?.["@_command"] ?? null,
            date: result?.["@_date"] ?? null,
            ip: result?.["@_ip"] ?? null,
        },
        product: {
            booked: toText(product?.booked), // yes/no
            code: toText(product?.code), // Internal DOTW code
            bookingReference: toText(product?.bookingReferenceNumber),
            supplierConfirmation: toText(product?.supplierConfirmation),

            service: {
                id: toText(product?.serviceId),
                name: toText(product?.serviceName),
                location: toText(product?.serviceLocation),
                price: parseFormattedPrice(product?.servicePrice),
                currency: toText(product?.currencyShort) || toText(product?.currency),
            },

            dates: {
                from: toText(product?.from),
                to: toText(product?.to),
                nights: toText(product?.numberOfNights),
            },

            status: {
                code: toText(product?.status),
                // Map common codes to text?
                // 1666=Confirmed, 1667=Cancelled, 1708=Saved, etc. 
                confirmed: toText(product?.status) === "1666",
                invoiced: normalizeBoolean(product?.invoiced),
                paymentGuaranteedBy: toText(product?.paymentGuaranteedBy),
            },

            room: {
                name: toText(product?.roomName),
                code: toText(product?.roomTypeCode),
                category: toText(product?.roomCategory),
                rateBasis: toText(product?.rateBasis),
                info: {
                    maxAdults: toText(product?.roomInfo?.maxAdult),
                    maxChildren: toText(product?.roomInfo?.maxChildren),
                    maxExtraBed: toText(product?.roomInfo?.maxExtraBed),
                }
            },

            pax: {
                adults: toText(product?.adults),
                childrenCount: product?.children?.["@_no"],
                passengers
            },

            policies: {
                cancellation: cancellationRules,
                cancel: normalizeBoolean(product?.cancel), // can cancel?
                amend: normalizeBoolean(product?.allowAmmend),
                onRequest: normalizeBoolean(product?.onRequest)
            },

            contact: {
                customerReference: toText(product?.customerReference),
                emergencyContacts: ensureArray(product?.emergencyContacts?.emergencyContact).map(c => ({
                    name: toText(c?.fullName),
                    phone: toText(c?.phone)
                }))
            },

            totals: {
                tax: parseFormattedPrice(product?.totalTaxes),
                fee: parseFormattedPrice(product?.totalFee),
                propertyFees: parsePropertyFees(product?.propertyFees),
            },

            notes: {
                tariff:
                    toText(product?.tariffNotes) ??
                    toText(product?.tariffNote) ??
                    toText(product?.rateNotes) ??
                    toText(product?.notes) ??
                    null,
            },

            extraMeals,
        }
    }
}
