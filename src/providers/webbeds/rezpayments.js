import axios from "axios"

const DEFAULT_TOKENIZER_URL = process.env.WEBBEDS_TOKENIZER_URL?.trim() ||
  "https://securepayapi.dev.rezpayments.com/"
const DEFAULT_TOKENIZER_AUTH = process.env.WEBBEDS_TOKENIZER_AUTH?.trim()

export const tokenizeCard = async ({
  cardName,
  cardNumber,
  expiryYear,
  expiryMonth,
  securityCode,
  tokenizerUrl = DEFAULT_TOKENIZER_URL,
  authHeader = DEFAULT_TOKENIZER_AUTH,
  logger = console,
} = {}) => {
  if (!cardNumber || !securityCode || !expiryMonth || !expiryYear) {
    throw new Error("Missing card details for tokenization")
  }
  if (!authHeader) {
    throw new Error("Missing WEBBEDS_TOKENIZER_AUTH")
  }
  if (process.env.NODE_ENV === "production") {
    try {
      const url = new URL(tokenizerUrl);
      if (url.protocol !== "https:") {
        throw new Error("WEBBEDS_TOKENIZER_URL must use https in production");
      }
    } catch {
      throw new Error("WEBBEDS_TOKENIZER_URL must be a valid https URL in production");
    }
  }

  const url = tokenizerUrl.endsWith("/")
    ? tokenizerUrl
    : `${tokenizerUrl}/`

  try {
    const response = await axios.post(
      url,
      {
        cardName,
        cardNumber,
        expiryYear: String(expiryYear),
        expiryMonth: String(expiryMonth).padStart(2, "0"),
        securityCode: String(securityCode),
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Secure-Pay-Authorization": authHeader,
        },
        timeout: 15000,
      },
    )

    const token = response?.data?.id
    if (!token) {
      throw new Error("Tokenization did not return an id")
    }
    return token
  } catch (error) {
    logger?.error?.("[webbeds] tokenization failed", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    })
    throw error
  }
}
