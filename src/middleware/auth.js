import jwt from "jsonwebtoken"
import dotenv from "dotenv"
dotenv.config()

export const authenticate = (req, res, next) => {
  const h = req.headers.authorization
  if (!h || !h.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" })
  const token = h.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.user = payload   // ← { sub, kind, role, roles? }
    next()
  } catch (err) {
    console.error(err)
    res.status(401).json({ error: "Invalid token" })
    return next(err)
  }
}

/** Autoriza por rol numérico (ej. 100=admin, 2=influencer, 3=corporate, 4=agency, 1=staff, 0=regular) */
export const authorizeRoles = (...allowed) => (req, res, next) => {
  const role = Number(req.user?.role)
  if (!allowed.includes(role)) return res.status(403).json({ error: "Forbidden" })
  next()
}


export const authorizeStaff = (req, res, next) => {
  if (req.user?.role !== 1) return res.status(403).json({ error: "Forbidden" });
  next();
};

// Lightweight guard for guest tokens (limited scope)
export const authenticateGuest = (req, res, next) => {
  const h = req.headers.authorization
  if (!h || !h.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" })
  const token = h.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload?.kind !== "guest") return res.status(403).json({ error: "Invalid guest token" })
    req.guest = payload // { kind:'guest', email, exp }
    next()
  } catch (err) {
    console.error(err)
    res.status(401).json({ error: "Invalid token" })
    return next(err)
  }
}
