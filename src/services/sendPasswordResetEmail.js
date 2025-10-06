import jwt from "jsonwebtoken"
import transporter from "./transporter.js"
import { getPasswordResetTemplate } from "../emailTemplates/password-reset-template.js"

function resolveClientUrl() {
  const candidates = [
    process.env.CLIENT_URL,
    process.env.WEBAPP_URL,
    process.env.FRONTEND_URL,
  ]
  const url = candidates.find((value) => value && String(value).trim().length > 0)
  if (!url) return "https://app.insiderbookings.com"
  return String(url).replace(/\/$/, "")
}

export default async function sendPasswordResetEmail(user) {
  if (!user?.email) throw new Error("User email is required")
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required")

  const token = jwt.sign(
    { id: user.id, type: "user", action: "reset-password" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  )

  const baseUrl = resolveClientUrl()
  const resetLink = `${baseUrl}/set-password?token=${encodeURIComponent(token)}&mode=reset`
  const firstName = (user?.name || "").split(" ")[0] || "there"

  const htmlContent = getPasswordResetTemplate(firstName, resetLink)
  const textContent = [
    `Hi ${firstName},`,
    "",
    "We received a request to reset your Insider Bookings password.",
    "Use the link below to choose a new one (the link expires in 60 minutes):",
    resetLink,
    "",
    "If you did not request this change, you can ignore this email.",
  ].join("\n")

  await transporter.sendMail({
    to: user.email,
    from: process.env.MAIL_FROM || `"Insider Bookings" <${process.env.SMTP_USER}>`,
    subject: "Reset your Insider Bookings password",
    html: htmlContent,
    text: textContent,
  })

  return token
}
