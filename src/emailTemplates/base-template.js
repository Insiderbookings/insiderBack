// Reusable base template for other emails
export function getBaseEmailTemplate(content, title = "Insider Bookings", branding = {}) {
  const brandName = branding.brandName || "Insider Bookings"
  const primaryColor = branding.primaryColor || "#0f172a"
  const accentColor = branding.accentColor || "#f97316"
  const backgroundColor = branding.backgroundColor || "#f8fafc"
  const bodyBackground = branding.bodyBackground || "#ffffff"
  const textColor = branding.textColor || "#ffffff"
  const headerAlign = branding.headerAlign || "center"
  const tagline = branding.tagline !== undefined ? branding.tagline : "Your exclusive booking platform"
  const taglineColor = branding.taglineColor || "rgba(226, 232, 240, 0.9)"
  const logoUrl = branding.logoUrl || ""
  const footerText = branding.footerText || `\u00a9 ${new Date().getFullYear()} ${brandName}. All rights reserved.`
  const supportText = branding.supportText || "Exclusive bookings for unique experiences"
  const socialLinks = Array.isArray(branding.socialLinks) ? branding.socialLinks : null
  const headerExtraHtml = branding.headerExtraHtml || ""
  const footerExtraHtml = branding.footerExtraHtml || ""

  const titleText = branding.headerTitle || brandName
  const subtitleText = branding.headerSubtitle || tagline

  const headerBrand = logoUrl
    ? `<img src="${logoUrl}" alt="${titleText}" style="max-width: 200px; height: auto; display: block; margin: 0 auto 12px;" />`
    : `<h1 style="color:${textColor};margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">${titleText}</h1>`

  const subtitle = subtitleText
    ? `<p style="color:${taglineColor};margin:8px 0 0;font-size:16px;opacity:0.9;">${subtitleText}</p>`
    : ""

  const socialsHtml = socialLinks
    ? socialLinks
        .map((item) => {
          if (!item || !item.href) return ""
          const label = item.label || ""
          const icon = item.icon || "•"
          const color = item.color || "#a0aec0"
          return `<a href="${item.href}" style="display:inline-block;margin:0 8px;color:${color};text-decoration:none;" target="_blank" rel="noopener noreferrer">${icon || label}</a>`
        })
        .join("")
    : `<a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
        <span style="font-size: 18px;">&#9733;</span>
      </a>
      <a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
        <span style="font-size: 18px;">&#9737;</span>
      </a>
      <a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
        <span style="font-size: 18px;">&#9739;</span>
      </a>`

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:${backgroundColor};">
      <table role="presentation" style="width:100%;border-collapse:collapse;background-color:${backgroundColor};">
        <tr>
          <td style="padding:40px 20px;">
            <table role="presentation" style="max-width:600px;margin:0 auto;background-color:${bodyBackground};border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);overflow:hidden;">
              <tr>
                <td style="background-color:${primaryColor};border-bottom:4px solid ${accentColor};padding:40px 30px;text-align:${headerAlign};">
                  ${headerBrand}
                  ${subtitle}
                  ${headerExtraHtml}
                </td>
              </tr>
              <tr>
                <td style="padding:40px 30px;color:#0f172a;">
                  ${content}
                </td>
              </tr>
              <tr>
                <td style="background-color:${backgroundColor};padding:30px;text-align:center;border-top:1px solid #e2e8f0;">
                  <p style="color:#a0aec0;margin:0 0 12px 0;font-size:14px;">${footerText}</p>
                  ${supportText ? `<p style="color:#a0aec0;margin:0;font-size:12px;">${supportText}</p>` : ""}
                  ${footerExtraHtml}
                  <div style="margin-top:20px;">
                    ${socialsHtml}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}
