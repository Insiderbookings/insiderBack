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
<meta charset="UTF-8">
<title>Reservation Confirmation Required</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* ─────────── General reset ─────────── */
  body      { margin: 0; padding: 0; background: #f5f7fb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  table     { border-collapse: collapse; width: 100%; }
  img       { border: 0; line-height: 100%; }
  a         { color: inherit; text-decoration: none; }

  /* ─────────── Brand palette ─────────── */
  :root {
    --brand-primary: #0a66ff;   /* botón y acentos  */
    --brand-light   : #eaf1ff;  /* icon bullet      */
    --brand-grey    : #444;
    --bg-card       : #ffffff;
    --bg-topbar     : #f0f2f5;
    --border-card   : #e3e8ee;
  }

  /* ─────────── Container card ─────────── */
  .card      { max-width: 600px; margin: 40px auto; background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 8px; overflow: hidden; box-shadow: 0 3px 12px rgba(55,71,79,.08); }
  .topbar    { background: var(--bg-topbar); padding: 10px 24px; font-size: 14px; color: var(--brand-grey); }
  .content   { padding: 32px 40px 40px; color: #1e1e1e; line-height: 1.55; }
  .content h1{ font-size: 22px; margin: 0 0 12px; }
  .content h2{ font-size: 16px; margin: 28px 0 10px; color: #111; display:flex; align-items:center; gap:8px; }
  .bullet    { width:10px; height:10px; background: var(--brand-primary); border-radius:50%; display:inline-block; }
  p          { margin: 0 0 14px; }
  hr         { border:none; border-top:1px solid var(--border-card); margin: 32px 0; }

  /* ─────────── CTA button ─────────── */
  .btn       { display:inline-block; background: var(--brand-primary); color:#ffffff!important; font-weight:600; padding:14px 26px; border-radius:6px; transition:background .2s ease-in; }
  .btn:hover { background:#004ce1; }

  /* ─────────── Footer ─────────── */
  .footer    { font-size:12px; color:#6b6b6b; }

  /* ─────────── Responsive tweaks ─────────── */
  @media(max-width:600px){
    .content { padding: 28px 22px 36px; }
  }
</style>
</head>
<body>
  <!-- Card -->
  <div class="card">
    <!-- Top bar -->
    <div class="topbar">✔ Fast Check-In</div>

    <!-- Main content -->
    <div class="content">
      <h1>Reservation Confirmation Required</h1>

      <p>Hi <strong>${firstName} ${lastName}</strong>,</p>
      <p>We’re looking forward to welcoming you <strong>${arrivalDate}</strong> – <strong>${departureDate}</strong>.</p>
      <p>To ensure a seamless arrival, please confirm your reservation in advance.</p>

      <!-- Booking reference -->
      <p><strong>Booking #:</strong> ${bookingConfirmation}</p>

      <!-- Step headline -->
      <h2><span class="bullet"></span> Step 1: Confirm Your Reservation</h2>
      <p>A USD 2 validation charge is required to verify your card and finalize check-in.</p>

      <!-- CTA -->
      <p style="text-align:center; margin:26px 0 34px;">
        <a href="${process.env.CLIENT_URL}/fast-checkin?booking=${bookingConfirmation}" class="btn">
          Confirm reservation – $2
        </a>
      </p>

      <hr>

      <!-- Footer note -->
      <p class="footer">
        Thank you for confirming in advance — we’ll be ready when you arrive!<br>
        See you soon,<br>
        Guest Services Team
      </p>
    </div>
  </div>
</body>
</html>
`;