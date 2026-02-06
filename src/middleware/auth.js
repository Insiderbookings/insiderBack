import jwt from "jsonwebtoken"
import dotenv from "dotenv"
import models from "../models/index.js"

dotenv.config()

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET

const normalizeBearer = (headerValue) => {
  if (!headerValue || typeof headerValue !== "string") return null
  if (!headerValue.startsWith("Bearer ")) return null
  const token = headerValue.slice(7).trim()
  return token || null
}

const verifyAccessToken = (token) => {
  if (!token) return null
  return jwt.verify(token, ACCESS_SECRET)
}

const parsePartnerKeys = () => {
  const raw =
    process.env.PARTNER_API_KEY ||
    process.env.PARTNER_API_KEYS ||
    process.env.VAULT_API_KEY ||
    ""
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export const authenticate = (req, res, next) => {
  const token = normalizeBearer(req.headers.authorization)
  if (!token) return res.status(401).json({ error: "Missing token" })
  try {
    const payload = verifyAccessToken(token)
    req.user = payload
    next()
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" })
    }
    console.error(err)
    return res.status(401).json({ error: "Invalid token" })
  }
}

export const authenticateOrPartnerKey = (req, res, next) => {
  const token = normalizeBearer(req.headers.authorization)
  if (token) {
    try {
      const payload = verifyAccessToken(token)
      req.user = payload
      return next()
    } catch (err) {
      if (err?.name === "TokenExpiredError") {
        return res.status(401).json({ error: "Token expired" })
      }
      console.error(err)
      return res.status(401).json({ error: "Invalid token" })
    }
  }

  const partnerKey =
    req.headers["x-partner-key"] ||
    req.headers["x-api-key"] ||
    req.headers["x-vault-key"]
  const allowedKeys = parsePartnerKeys()
  if (partnerKey && allowedKeys.includes(String(partnerKey).trim())) {
    req.partner = { key: String(partnerKey).trim().slice(0, 6) }
    return next()
  }

  return res.status(401).json({ error: "Unauthorized" })
}

/** Autoriza por rol numerico (ej. 100=admin, 2=influencer, 3=corporate, 4=agency, 1=staff, 0=regular) */
export const authorizeRoles = (...allowed) => (req, res, next) => {
  const role = Number(req.user?.role)
  if (!allowed.includes(role)) return res.status(403).json({ error: "Forbidden" })
  next()
}

export const authorizeStaff = (req, res, next) => {
  if (req.user?.role !== 1) return res.status(403).json({ error: "Forbidden" })
  next()
}

export const requireVerifiedEmail = async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" })
    if (req.user?.type && req.user.type !== "user") return next()

    const user = await models.User.findByPk(req.user.id, {
      attributes: ["id", "email_verified"],
    })
    if (!user) return res.status(404).json({ error: "User not found" })
    if (!user.email_verified) {
      return res.status(403).json({ error: "Email verification required" })
    }
    return next()
  } catch (err) {
    console.error("requireVerifiedEmail error:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// Lightweight guard for guest tokens (limited scope)
export const authenticateGuest = (req, res, next) => {
  const h = req.headers.authorization
  if (!h || !h.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" })
  const token = h.slice(7)
  try {
    const payload = jwt.verify(token, ACCESS_SECRET)
    if (payload?.kind !== "guest") return res.status(403).json({ error: "Invalid guest token" })
    req.guest = payload
    next()
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" })
    }
    console.error(err)
    return res.status(401).json({ error: "Invalid token" })
  }
}
