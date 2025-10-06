import transporter from "./transporter.js"
import { getContractNotificationTemplate } from "../emailTemplates/contract-notification-template.js"

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

export default async function sendContractNotificationEmail(user, contract = {}) {
  if (!user?.email) throw new Error("User email is required")

  const contractsLink = `${resolveClientUrl()}/contracts`
  const firstName = (user?.name || "").split(" ")[0] || "there"
  const title = contract?.title || "New contract"

  const htmlContent = getContractNotificationTemplate(firstName, title, contractsLink)
  const textContent = [
    `Hi ${firstName},`,
    "",
    `A new Insider contract is ready for your role: ${title}.`,
    "Please sign in to Insider Bookings and review it under Profile > Contracts:",
    contractsLink,
    "",
    "Need help? Reply to this email and our team will assist you.",
  ].join("\n")

  await transporter.sendMail({
    to: user.email,
    from: process.env.MAIL_FROM || `"Insider Bookings" <${process.env.SMTP_USER}>`,
    subject: `New Insider contract: ${title}`,
    html: htmlContent,
    text: textContent,
  })
}
