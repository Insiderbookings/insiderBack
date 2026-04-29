import transporter from "./transporter.js"
import { getContractNotificationTemplate } from "../emailTemplates/contract-notification-template.js"
import { resolveMailFrom } from "../helpers/mailFrom.js"
import { buildInsiderUrl } from "../helpers/appUrls.js"

export default async function sendContractNotificationEmail(user, contract = {}) {
  if (!user?.email) throw new Error("User email is required")

  const contractsLink = buildInsiderUrl("contracts")
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
    from: resolveMailFrom(),
    subject: `New Insider contract: ${title}`,
    html: htmlContent,
    text: textContent,
  })
}
