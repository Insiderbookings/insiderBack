import transporter from "./transporter.js"
import jwt from "jsonwebtoken"
import { getMagicLinkTemplate } from "../emailTemplates/magic-link-template.js"

export default async function sendMagicLink(user) {
  const token = jwt.sign({ id: user.id, type: "user", action: "set-password" }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  })

  const link = `${process.env.CLIENT_URL}/set-password?token=${token}`
  const firstName = user.name.split(" ")[0]

  // Enhanced HTML version
  const htmlContent = getMagicLinkTemplate(firstName, link)

  // Plain text version as fallback
  const textContent = `
Hello ${firstName},

You're just one step away from completing your Insider Bookings account setup.

Click the following link to set your password:
${link}

This link is valid for 24 hours for security reasons.

If you didn't request this account, you can safely ignore this email.

Best regards,
The Insider Bookings Team

© ${new Date().getFullYear()} Insider Bookings. All rights reserved.
  `.trim()

  await transporter.sendMail({
    to: user.email,
    from: `"Insider Bookings" <${process.env.SMTP_USER}>`,
    subject: "🔐 Set up your password - Insider Bookings",
    html: htmlContent,
    text: textContent, // Fallback for clients that don't support HTML
  })
}
