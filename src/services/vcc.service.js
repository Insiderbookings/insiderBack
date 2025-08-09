import Stripe from "stripe"
import dotenv from "dotenv"

dotenv.config()

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2022-11-15" })

/**
 * Crear un cardholder corporativo para emitir VCCs
 */
export async function createCardholder(companyName = "Hotel Booking Platform") {
  try {
    const cardholder = await stripe.issuing.cardholders.create({
      type: "company",
      name: companyName,
      email: process.env.COMPANY_EMAIL || "bookings@yourplatform.com",
      phone_number: process.env.COMPANY_PHONE || "+1234567890",
      billing: {
        address: {
          line1: "123 Business St",
          city: "Business City",
          state: "BC",
          postal_code: "12345",
          country: "US",
        },
      },
    })
    
    console.log("✅ Cardholder created:", cardholder.id)
    return cardholder
  } catch (error) {
    console.error("❌ Error creating cardholder:", error)
    throw error
  }
}

/**
 * Crear una VCC (Virtual Credit Card) para un booking específico
 */
export async function createVCC({
  amount,
  currency = "eur",
  guestName,
  bookingReference,
  cardholderName = "Hotel Booking Platform"
}) {
  try {
    // Obtener o crear cardholder
    let cardholder
    if (process.env.STRIPE_ISSUING_CARDHOLDER) {
      cardholder = await stripe.issuing.cardholders.retrieve(process.env.STRIPE_ISSUING_CARDHOLDER)
    } else {
      cardholder = await createCardholder(cardholderName)
    }

    // Crear la tarjeta virtual
    const card = await stripe.issuing.cards.create({
      cardholder: cardholder.id,
      currency: currency.toLowerCase(),
      type: "virtual",
      spending_controls: {
        spending_limits: [
          {
            amount: Math.round(amount * 100), // Stripe usa centavos
            interval: "all_time",
          },
        ],
        allowed_categories: ["lodging"], // Categoría específica para hoteles
      },
      metadata: {
        purpose: "hotel_booking",
        guest_name: guestName,
        booking_reference: bookingReference,
      },
    })

    console.log("✅ VCC created:", card.id)

    return {
      id: card.id,
      number: card.number,
      cvc: card.cvc,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      spending_limit: amount,
      currency: currency.toUpperCase(),
    }
  } catch (error) {
    console.error("❌ Error creating VCC:", error)
    throw error
  }
}

/**
 * Formatear VCC para TravelgateX
 */
export function formatVCCForTravelgate(vcc, holderName, holderSurname) {
  return {
    type: getCardType(vcc.number),
    holder: {
      name: holderName,
      surname: holderSurname,
    },
    number: vcc.number,
    CVC: vcc.cvc,
    expire: {
      month: vcc.exp_month,
      year: vcc.exp_year,
    },
    isVCC: true,
    virtualCreditCard: {
      activationDate: new Date().toISOString().split('T')[0],
      deactivationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 días
      currentBalance: vcc.spending_limit,
      currencyCode: vcc.currency,
    },
  }
}

/**
 * Determinar el tipo de tarjeta basado en el número
 */
function getCardType(cardNumber) {
  const firstDigit = cardNumber.charAt(0)
  const firstTwoDigits = cardNumber.substring(0, 2)
  const firstFourDigits = cardNumber.substring(0, 4)

  if (firstDigit === "4") return "VI" // Visa
  if (["51", "52", "53", "54", "55"].includes(firstTwoDigits)) return "MC" // Mastercard
  if (["34", "37"].includes(firstTwoDigits)) return "AX" // American Express
  if (firstFourDigits === "6011") return "DS" // Discover

  return "VI" // Default to Visa
}

/**
 * Cancelar/desactivar una VCC
 */
export async function cancelVCC(cardId) {
  try {
    const card = await stripe.issuing.cards.update(cardId, {
      status: "canceled",
    })
    
    console.log("✅ VCC canceled:", cardId)
    return card
  } catch (error) {
    console.error("❌ Error canceling VCC:", error)
    throw error
  }
}
