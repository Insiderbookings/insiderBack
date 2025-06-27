import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

export const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing token" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) return res.status(401).json({ error: "Invalid token" });
    req.user = payload;
    console.log(req.user, "en middles")
    next();
  });
};

export const authorizeStaff = (req, res, next) => {
  if (req.user?.type !== "staff") return res.status(403).json({ error: "Forbidden" });
  next();
};

export const authorizeAdmin = (req, res, next) => {
  if (req.user?.type !== "staff" || req.user?.roleName !== "manager") {
    return res.status(403).json({ error: "Admin only" });
  }
  next();
};
