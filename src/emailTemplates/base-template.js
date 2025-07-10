// Reusable base template for other emails
export function getBaseEmailTemplate(content, title = "Insider Bookings") {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 40px 20px;">
            <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden;">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                    Insider Bookings
                  </h1>
                  <p style="color: #e2e8f0; margin: 8px 0 0 0; font-size: 16px; opacity: 0.9;">
                    Your exclusive booking platform
                  </p>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  ${content}
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="color: #a0aec0; margin: 0 0 12px 0; font-size: 14px;">
                    © ${new Date().getFullYear()} Insider Bookings. All rights reserved.
                  </p>
                  <p style="color: #a0aec0; margin: 0; font-size: 12px;">
                    Exclusive bookings for unique experiences
                  </p>
                  
                  <div style="margin-top: 20px;">
                    <a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
                      <span style="font-size: 18px;">📧</span>
                    </a>
                    <a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
                      <span style="font-size: 18px;">📱</span>
                    </a>
                    <a href="#" style="display: inline-block; margin: 0 8px; color: #a0aec0; text-decoration: none;">
                      <span style="font-size: 18px;">🌐</span>
                    </a>
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
