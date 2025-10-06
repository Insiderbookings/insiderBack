import { getBaseEmailTemplate } from "./base-template.js"

export function getContractNotificationTemplate(userName, contractTitle, contractsLink) {
  const safeName = userName && typeof userName === "string" && userName.trim() ? userName.trim() : "there"
  const title = contractTitle && typeof contractTitle === "string" && contractTitle.trim() ? contractTitle.trim() : "New role contract"

  const content = `
    <h2 style="color:#1a202c;margin:0 0 18px;font-size:24px;font-weight:600;">
      Hi ${safeName},
    </h2>

    <p style="color:#4a5568;margin:0 0 16px;font-size:16px;line-height:1.6;">
      A new Insider contract is ready for your role: <strong>${title}</strong>.
      Review it carefully and sign it to keep your account in good standing.
    </p>

    <table role="presentation" style="margin:28px 0;">
      <tr>
        <td align="center">
          <a href="${contractsLink}"
             style="display:inline-block;background:linear-gradient(135deg,#38b2ac 0%,#3182ce 100%);color:#ffffff;text-decoration:none;padding:15px 30px;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 6px 16px rgba(49,130,206,0.35);transition:all .3s ease;">
            View Contracts
          </a>
        </td>
      </tr>
    </table>

    <p style="color:#4a5568;margin:0 0 16px;font-size:15px;line-height:1.6;">
      You can find this and any other pending agreements under <em>Profile &gt; Contracts</em> inside Insider Bookings.
    </p>

    <p style="color:#718096;margin:18px 0 0;font-size:13px;line-height:1.5;">
      Need help? Reply to this email and our team will be happy to assist you.
    </p>
  `

  return getBaseEmailTemplate(content, "New contract available - Insider Bookings")
}
