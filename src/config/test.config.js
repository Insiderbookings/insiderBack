// Configuración para entorno de pruebas
export const TEST_CONFIG = {
  stripe: {
    // Tarjetas de prueba de Stripe
    testCards: {
      visa: "4242424242424242",
      visaDebit: "4000056655665556",
      mastercard: "5555555555554444",
      amex: "378282246310005",
      declined: "4000000000000002",
    },
    testCVC: "123",
    testExpiry: {
      month: 12,
      year: 2030,
    },
  },
}

// Función para obtener configuración de Stripe según el entorno
export function getStripeConfig() {
  return {
    publishableKey: process.env.NODE_ENV === "production" 
      ? process.env.STRIPE_PUBLISHABLE_KEY 
      : process.env.STRIPE_TEST_PUBLISHABLE_KEY,
    secretKey: process.env.NODE_ENV === "production"
      ? process.env.STRIPE_SECRET_KEY
      : process.env.STRIPE_TEST_SECRET_KEY,
  }
}
