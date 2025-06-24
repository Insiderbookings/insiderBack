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
  roomType,
  roomNumber,
  phoneNumber,
}) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Reservation Confirmation Required</title>
  <style>
    body       { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #f9f9f9; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .topbar    { background: #e0e0e0; color: #333333; padding: 12px 24px; font-size: 14px; }
    .header    { background: #d79d00; color: #ffffff; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; }
    .body      { padding: 24px 32px; color: #333333; }
    .body h2   { font-size: 18px; margin: 24px 0 12px 0; }
    p          { margin: 0 0 12px; line-height: 1.5; }
    .btn       { display: inline-block; background: #2d7ff9; color: #ffffff !important; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: bold; }
    .footer    { font-size: 12px; color: #777777; margin-top: 32px; }
    hr         { border: none; border-top: 1px solid #eeeeee; margin: 32px 0; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Fast Check-In top bar -->
    <div class="topbar">
      ✓ Fast Check-In
    </div>

    <!-- Main header -->
    <div class="header">
      <h1>
        ✓ Reservation Confirmation Required
      </h1>
    </div>

    <!-- Body content -->
    <div class="body">
      <p>Hi ${firstName} ${lastName},</p>
      <p><strong>Booking #:</strong> ${bookingConfirmation}</p>

      <p>We’re excited to welcome you on <strong>${arrivalDate}</strong>! To ensure a smooth check-in process, please confirm your reservation in advance.</p>

      <h2>
        ♦ Step 1: Confirm Your Reservation
      </h2>
      <p>A $2 confirmation is required to validate your card and finalize check-in.</p>

      <p style="text-align:center; margin: 24px 0;">
        <a
          href="${process.env.CLIENT_URL}/fast-checkin?booking=${bookingConfirmation}"
          class="btn"
        >
          Click here to confirm your reservation ($2)
        </a>
      </p>

      <hr/>

      <p class="footer">
        Thank you for confirming in advance—we’ll be ready when you arrive!<br/>
        See you soon,<br/>
        Guest Services Team
      </p>
    </div>
  </div>
</body>
</html>
`;
