import transporter from "./transporter.js";          // tu mismo transport
import jwt from "jsonwebtoken";

export default async function sendMagicLink(user) {
  const token = jwt.sign(
    { id: user.id, type: "user", action: "set-password" },
    process.env.JWT_SECRET,
    { expiresIn: "1d" },
  );

  const link = `${process.env.CLIENT_URL}/set-password?token=${token}`;

  await transporter.sendMail({
    to     : user.email,
    from   : `"Insider Bookings" <${process.env.SMTP_USER}>`,
    subject: "Finish setting up your account",
    html   : `<p>Hi ${user.name.split(" ")[0]}, click the link to set your password:<br/>
              <a href="${link}">${link}</a></p>`,
  });
}