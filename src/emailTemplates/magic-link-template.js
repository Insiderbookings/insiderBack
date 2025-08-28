import { getBaseEmailTemplate } from "./base-template.js"

/**
 * Returns a styled HTML e-mail for the magic-link flow.
 * Suggested subject: “Your Insider Perks Account is Ready!”
 *
 * @param {string} userName  – Recipient’s display name
 * @param {string} magicLink – URL with the JWT token
 * @returns {string}         – HTML string
 */
export function getMagicLinkTemplate(userName, magicLink) {
  const content = `
    <h2 style="color:#1a202c;margin:0 0 20px;font-size:24px;font-weight:600;">
      Hello&nbsp;${userName}! 👋
    </h2>

    <p style="color:#4a5568;margin:0 0 16px;font-size:16px;line-height:1.6;">
      Your check-in is confirmed and your Insider Perks account has just been created so you can manage every benefit of your stay.
    </p>

    <p style="color:#4a5568;margin:0 0 24px;font-size:16px;line-height:1.6;">
      Click the button below to set a password and unlock your exclusive perks whenever you like.
    </p>

    <table role="presentation" style="margin:32px 0;">
      <tr>
        <td align="center">
          <a href="${magicLink}"
             style="display:inline-block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 4px 14px rgba(102,126,234,.4);transition:all .3s ease;">
            Set Your Password
          </a>
        </td>
      </tr>
    </table>

    <div style="background:#f7fafc;border-left:4px solid #667eea;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
      <p style="color:#2d3748;margin:0;font-size:14px;line-height:1.5;">
        <strong>💡 Tip:</strong> This link is valid for 24 hours. If you can’t click the button, copy &amp; paste this URL:
      </p>
      <p style="color:#667eea;margin:8px 0 0;font-size:14px;word-break:break-all;">
        ${magicLink}
      </p>
    </div>

    <p style="color:#718096;margin:24px 0 0;font-size:14px;line-height:1.5;">
      If you didn’t request this, just ignore this e-mail.
    </p>
  `

  return getBaseEmailTemplate(content, "Set up your account – Insider Bookings")
}

