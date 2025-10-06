import { getBaseEmailTemplate } from "./base-template.js"

export function getPasswordResetTemplate(userName, resetLink) {
  const safeName = userName && typeof userName === "string" && userName.trim() ? userName.trim() : "there"

  const content = `
    <h2 style="color:#1a202c;margin:0 0 20px;font-size:24px;font-weight:600;">
      Hello&nbsp;${safeName}!
    </h2>

    <p style="color:#4a5568;margin:0 0 16px;font-size:16px;line-height:1.6;">
      We received a request to reset your Insider Bookings password. You can create a new one using the button below.
    </p>

    <table role="presentation" style="margin:32px 0;">
      <tr>
        <td align="center">
          <a href="${resetLink}"
             style="display:inline-block;background-color:#f56565;background-image:linear-gradient(135deg,#f56565 0%,#ed8936 100%);color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 6px 18px rgba(245,101,101,0.35);transition:all .3s ease;border:1px solid #f56565;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>

    <div style="background:#fff5f5;border-left:4px solid #f56565;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
      <p style="color:#c53030;margin:0;font-size:14px;line-height:1.5;">
        <strong>Heads up:</strong> This link expires in 60 minutes. If it stops working, you can request a new reset from the login page.
      </p>
      <p style="color:#f56565;margin:8px 0 0;font-size:14px;word-break:break-all;">
        ${resetLink}
      </p>
    </div>

    <p style="color:#718096;margin:24px 0 0;font-size:14px;line-height:1.5;">
      If you did not ask to change your password, you can safely ignore this email.
    </p>
  `

  return getBaseEmailTemplate(content, "Reset your password  Insider Bookings")
}
