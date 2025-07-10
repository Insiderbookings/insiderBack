/**
 * getMagicLinkTemplate
 * ------------------------------------------------------------
 * Returns a fully-styled HTML e-mail for the magic-link flow.
 * Suggested subject: “Your Insider Perks Account is Ready!”
 * ------------------------------------------------------------
 * @param {string} userName  – Recipient’s display name
 * @param {string} magicLink – URL with the JWT token
 * @returns {string}         – HTML string
 */
export function getMagicLinkTemplate(userName, magicLink) {
  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1.0" />
        <title>Set up your account – Insider Bookings</title>
      </head>

      <body style="margin:0;padding:0;font-family:-apple-system,Segoe UI,Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f8fafc;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:40px 20px;">
              <table role="presentation" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,.1);overflow:hidden;">

                <!-- ── Header ───────────────────────────────────── -->
                <tr>
                  <td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:40px 30px;text-align:center;">
                    <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">
                      Insider Bookings
                    </h1>
                    <p style="color:#e2e8f0;margin:8px 0 0;font-size:16px;opacity:.9;">
                      Your exclusive booking platform
                    </p>
                  </td>
                </tr>

                <!-- ── Main content ────────────────────────────── -->
                <tr>
                  <td style="padding:40px 30px;">
                    <h2 style="color:#1a202c;margin:0 0 20px;font-size:24px;font-weight:600;">
                      Hello&nbsp;${userName}! 👋
                    </h2>

                    <!-- NEW intro block -->
                    <p style="color:#4a5568;margin:0 0 16px;font-size:16px;line-height:1.6;">
                      Your check-in is confirmed and your Insider Perks account has
                      just been created so you can manage every benefit of your stay.
                    </p>

                    <p style="color:#4a5568;margin:0 0 24px;font-size:16px;line-height:1.6;">
                      Click the button below to set a password and unlock your
                      exclusive perks whenever you like.
                    </p>

                    <!-- CTA button -->
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

                    <!-- Info / fallback link -->
                    <div style="background:#f7fafc;border-left:4px solid #667eea;padding:16px 20px;margin:24px 0;border-radius:0 8px 8px 0;">
                      <p style="color:#2d3748;margin:0;font-size:14px;line-height:1.5;">
                        <strong>💡 Tip:</strong> This link is valid for 24 hours.
                        If you can’t click the button, copy &amp; paste this URL:
                      </p>
                      <p style="color:#667eea;margin:8px 0 0;font-size:14px;word-break:break-all;">
                        ${magicLink}
                      </p>
                    </div>

                    <p style="color:#718096;margin:24px 0 0;font-size:14px;line-height:1.5;">
                      If you didn’t request this, just ignore this e-mail.
                    </p>
                  </td>
                </tr>

                <!-- ── Footer ─────────────────────────────────── -->
                <tr>
                  <td style="background:#f8fafc;padding:30px;text-align:center;border-top:1px solid #e2e8f0;">
                    <p style="color:#a0aec0;margin:0 0 12px;font-size:14px;">
                      © ${new Date().getFullYear()} Insider Bookings. All rights reserved.
                    </p>
                    <p style="color:#a0aec0;margin:0;font-size:12px;">
                      Exclusive bookings for unique experiences
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}
