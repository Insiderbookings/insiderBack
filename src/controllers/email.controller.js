// src/controllers/email.controller.js
import nodemailer from "nodemailer";

/* ---------- transport ---------- */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/* ---------- controller ---------- */
// src/controllers/email.controller.js
import db           from "../models/index.js";   // adjust to your import style
const { OutsideBooking } = db;

export const sendReservationEmail = async (req, res) => {
  const {
    arrivalDate,
    departureDate,
    firstName,
    lastName,
    bookingConfirmation,
    roomType,
    roomNumber,
    email,
    phoneNumber,
  } = req.body;

  /* ---------- basic validation ---------- */
  if (
    !arrivalDate || !departureDate || !firstName || !lastName ||
    !bookingConfirmation || !roomType || !roomNumber || !email || !phoneNumber
  ) {
    return res.status(400).json({ message: "Missing required data." });
  }

  try {
    /* ---------- 1.  Save to DB ---------- */
    await OutsideBooking.create({
      bookingConfirmation,
      room_number : roomNumber,
      room_type   : roomType,
      checkIn     : arrivalDate,
      checkOut    : departureDate,
      guestName   : firstName,
      guestLastName : lastName,
      guestEmail  : email,
      guestPhone  : phoneNumber,
      status      : "pending",   // guest still needs to confirm
      paymentStatus: "paid",
    });

    /* ---------- 2. Compose & send email ---------- */
    const html = reservationTemplate({
      arrivalDate,
      departureDate,
      firstName,
      lastName,
      bookingConfirmation,
      roomType,
      roomNumber,
      phoneNumber,
    });

    const mailOptions = {
      from   : `"Insider Bookings" <${process.env.SMTP_USER}>`,
      to     : email,
      subject: "Reservation Confirmation Required",
      html,
    };

    await transporter.sendMail(mailOptions);

    return res.json({ message: "Email sent and booking stored." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Could not send email / save booking." });
  }
};


/* ---------- template helper ---------- */
const reservationTemplate = ({
  arrivalDate,
  departureDate,
  firstName,
  lastName,
  bookingConfirmation,
}) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <!--[if !mso]><!-->
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!--<![endif]-->
  <title>Reservation Confirmation Required</title>
</head>
<body style="margin:0; padding:0; background:#f5f5f5; font-family:Arial,Helvetica,sans-serif;">
  <!-- WRAPPER -->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
      
        <!-- CARD -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.08);">
          
          <!-- TOP BAR -->
          <tr>
            <td style="background:#fff4d6; padding:10px 24px; font-size:14px; font-weight:600; color:#333333;">
              <span style="display:inline-block; width:18px; height:18px; background:#007aff; color:#ffffff; text-align:center; border-radius:4px; line-height:18px;">✓</span>
              &nbsp;Fast&nbsp;Check-In
            </td>
          </tr>
          
          <!-- TITLE -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <h1 style="margin:0; font-size:22px; line-height:1.3; color:#101010;">
                <span style="font-size:26px;">⚫</span>&nbsp;
                Reservation Confirmation Required
              </h1>
            </td>
          </tr>
          
          <!-- BODY -->
          <tr>
            <td style="padding:0 32px 32px 32px; font-size:15px; line-height:1.6; color:#333333;">
              
              <p style="margin:0 0 12px 0;">Hi <strong>${firstName} ${lastName}</strong>,</p>
              
              <p style="margin:0 0 12px 0;">
                We’re looking forward to welcoming you <strong>${arrivalDate} – ${departureDate}</strong>.
              </p>
              
              <p style="margin:0 0 12px 0;">
                To ensure a seamless arrival, please confirm your reservation in advance.
              </p>
              
              <p style="margin:0 0 24px 0;"><strong>Booking #:</strong> ${bookingConfirmation}</p>
              
              <!-- STEP -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px 0;">
                <tr>
                  <td style="font-size:16px; font-weight:bold; color:#101010; padding-bottom:4px;">
                    <span style="color:#007aff; font-size:18px;">♦</span>
                    &nbsp;Step&nbsp;1:&nbsp;Confirm&nbsp;Your&nbsp;Reservation
                  </td>
                </tr>
                <tr>
                  <td style="font-size:14px; color:#333333; padding-bottom:18px;">
                    A USD 2 validation charge is required to verify your card and finalize check-in.
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:24px;">
                    <!-- BUTTON -->
                    <a href="${process.env.CLIENT_URL}/fast-checkin?booking=${bookingConfirmation}"
                       style="background:#007aff; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:4px; font-weight:bold; display:inline-block;"
                       target="_blank">
                      Confirm reservation — $2
                    </a>
                  </td>
                </tr>
              </table>
              
              <!-- FOOTER -->
              <p style="margin:0 0 4px 0;">
                Thank you for confirming in advance&nbsp;— we’ll be ready when you arrive!
              </p>
              <p style="margin:0;">
                See you soon,<br/>
                Guest Services Team
              </p>
              
            </td>
          </tr>
          
        </table><!-- /CARD -->
        
      </td>
    </tr>
  </table><!-- /WRAPPER -->
</body>
</html>
`;
