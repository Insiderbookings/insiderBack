import bcrypt from "bcrypt"
import models, { sequelize } from "../models/index.js"
import crypto from "node:crypto"
import { Op } from "sequelize" // â† Agregar esta importaciÃ³n
import { sendMail } from "../helpers/mailer.js"
import { ReferralError, linkReferralCodeForUser, loadInfluencerIncentives, recordInfluencerEvent } from "../services/referralRewards.service.js"
import { processInfluencerPayoutBatch } from "./influencerPayout.controller.js"
import { deriveRoleCodes } from "../utils/userCapabilities.js"
import { getStripeClient } from "../services/payoutProviders.js"
import {
  ensureInfluencerOnboardingMetadata,
  isInfluencerIdentityVerified,
} from "../utils/influencerOnboarding.js"

const DISCOUNT_REMINDER_GRACE_DAYS = 1
const LOGIN_TOUCH_INTERVAL_MS = 5 * 60 * 1000
const REFERRAL_FIRST_BOOKING_DEFAULT_PCT = 15

const referralFirstBookingPct = () => {
  const value = Number(process.env.REFERRAL_FIRST_BOOKING_PCT)
  if (Number.isFinite(value) && value > 0) {
    return Math.round(value)
  }
  return REFERRAL_FIRST_BOOKING_DEFAULT_PCT
}

const normalizeDiscountCode = (value) => String(value || "").trim().toUpperCase()
const isValidEmail = (value = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())

const normalizeNamePart = (value) => {
  const trimmed = String(value || "").trim()
  return trimmed ? trimmed : null
}

const normalizeFullName = (value) => {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ")
  return trimmed ? trimmed : null
}

const splitFullName = (value) => {
  const fullName = normalizeFullName(value)
  if (!fullName) return { fullName: null, firstName: null, lastName: null }
  const parts = fullName.split(" ")
  const firstName = parts[0] || null
  const lastName = parts.slice(1).join(" ") || null
  return { fullName, firstName, lastName }
}

const resolveNameParts = ({ name, firstName, lastName }) => {
  const normalizedFirst = normalizeNamePart(firstName)
  const normalizedLast = normalizeNamePart(lastName)
  let fullName = normalizeFullName(name)

  if (!fullName && (normalizedFirst || normalizedLast)) {
    fullName = [normalizedFirst, normalizedLast].filter(Boolean).join(" ").trim() || null
  }

  let resolvedFirst = normalizedFirst
  let resolvedLast = normalizedLast
  if (fullName && (!resolvedFirst || !resolvedLast)) {
    const derived = splitFullName(fullName)
    if (!resolvedFirst) resolvedFirst = derived.firstName
    if (!resolvedLast) resolvedLast = derived.lastName
    if (!fullName) fullName = derived.fullName
  }

  return { fullName, firstName: resolvedFirst, lastName: resolvedLast }
}

const shouldTouchLastLogin = (value) => {
  if (!value) return true
  const last = new Date(value).getTime()
  return Number.isFinite(last) && Date.now() - last >= LOGIN_TOUCH_INTERVAL_MS
}

const ensureDiscountCodeLock = async (user) => {
  if (!user) return user
  if (user.discount_code_locked_at || user.discount_code_entered_at) return user
  if (user.referred_by_influencer_id || user.referred_by_code) return user

  const reminderAt = user.discount_code_reminder_at
  if (!reminderAt) return user

  const reminderTime = new Date(reminderAt).getTime()
  if (!Number.isFinite(reminderTime)) return user

  const graceMs = DISCOUNT_REMINDER_GRACE_DAYS * 24 * 60 * 60 * 1000
  if (Date.now() <= reminderTime + graceMs) return user

  await user.update({ discount_code_locked_at: new Date() })
  return user
}

const asPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {}

const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const INFLUENCER_CODE_MIN_LENGTH = 4
const INFLUENCER_CODE_MAX_LENGTH = 6
const INFLUENCER_CODE_PATTERN = new RegExp(
  `^[A-Z0-9]{${INFLUENCER_CODE_MIN_LENGTH},${INFLUENCER_CODE_MAX_LENGTH}}$`
)
const USER_CODE_LENGTH_RAW = Number(
  process.env.INFLUENCER_USER_CODE_LENGTH || INFLUENCER_CODE_MAX_LENGTH
)
const USER_CODE_LENGTH =
  Number.isFinite(USER_CODE_LENGTH_RAW) &&
  USER_CODE_LENGTH_RAW >= INFLUENCER_CODE_MIN_LENGTH &&
  USER_CODE_LENGTH_RAW <= INFLUENCER_CODE_MAX_LENGTH
    ? Math.trunc(USER_CODE_LENGTH_RAW)
    : INFLUENCER_CODE_MAX_LENGTH

const DEFAULT_INFLUENCER_IDENTITY_RETURN_URL = "https://bookinggpt.app/influencer-identity/complete"
const normalizeInfluencerCode = (value) => String(value || "").trim().toUpperCase()
const isValidInfluencerCode = (value) =>
  INFLUENCER_CODE_PATTERN.test(normalizeInfluencerCode(value))

const generateCandidateUserCode = () => {
  let output = ""
  const bytes = crypto.randomBytes(USER_CODE_LENGTH)
  for (let index = 0; index < USER_CODE_LENGTH; index += 1) {
    output += USER_CODE_ALPHABET[bytes[index] % USER_CODE_ALPHABET.length]
  }
  return output
}

const findUserByInfluencerCode = async ({ code, transaction }) =>
  models.User.findOne({
    where: sequelize.where(
      sequelize.fn("lower", sequelize.col("user_code")),
      normalizeInfluencerCode(code).toLowerCase()
    ),
    attributes: ["id", "user_code"],
    transaction,
  })

const ensureInfluencerUserCode = async ({ user, transaction }) => {
  const existing = normalizeInfluencerCode(user?.user_code)
  if (existing) {
    if (existing !== user.user_code) {
      await user.update({ user_code: existing }, { transaction })
    }
    return existing
  }

  for (let attempts = 0; attempts < 25; attempts += 1) {
    const code = generateCandidateUserCode()
    const duplicate = await findUserByInfluencerCode({ code, transaction })
    if (!duplicate || Number(duplicate.id) === Number(user.id)) {
      await user.update({ user_code: code }, { transaction })
      return code
    }
  }

  throw new Error("Unable to generate influencer code")
}

const ensureInfluencerGuestProfile = async ({ userId, transaction }) => {
  if (!models.GuestProfile) return null
  const [profile] = await models.GuestProfile.findOrCreate({
    where: { user_id: userId },
    defaults: {
      user_id: userId,
      identity_verified: false,
      metadata: ensureInfluencerOnboardingMetadata({}),
    },
    transaction,
  })
  return profile
}

const resolveInfluencerIdentityReturnUrl = () => {
  const explicit = String(
    process.env.STRIPE_INFLUENCER_IDENTITY_RETURN_URL ||
      process.env.STRIPE_IDENTITY_RETURN_URL ||
      ""
  ).trim()
  if (explicit) return explicit
  return DEFAULT_INFLUENCER_IDENTITY_RETURN_URL
}

const normalizeInfluencerIdentityReturnUrl = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production"
    const protocol = String(parsed.protocol || "").toLowerCase()
    if (protocol !== "https:" && protocol !== "http:") return null
    if (isProd && protocol !== "https:") return null

    const host = String(parsed.hostname || "").toLowerCase()
    const isBookingHost = host === "bookinggpt.app" || host.endsWith(".bookinggpt.app")
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
    if (!isBookingHost && !(!isProd && isLocalHost)) return null

    const path = String(parsed.pathname || "")
    if (!path.startsWith("/influencer-identity")) return null

    return parsed.toString()
  } catch {
    return null
  }
}

const normalizeHotelPricingRequestData = (body = {}) => {
  const fullName = normalizeFullName(body?.fullName ?? body?.name ?? body?.contactName)
  const agencyCompanyName = normalizeNamePart(
    body?.agencyCompanyName ?? body?.companyName ?? body?.agencyName ?? body?.businessName
  )
  const phone = normalizeNamePart(body?.phone ?? body?.phoneNumber ?? body?.contactPhone)
  const monthlyBookingsRaw = Number(
    body?.expectedMonthlyBookings ?? body?.monthlyBookings ?? body?.bookingsPerMonth ?? body?.volume
  )
  const expectedMonthlyBookings =
    Number.isFinite(monthlyBookingsRaw) && monthlyBookingsRaw > 0
      ? Math.round(monthlyBookingsRaw)
      : null
  const notes = normalizeNamePart(body?.notes ?? body?.message ?? body?.comment)
  return {
    fullName,
    agencyCompanyName,
    phone,
    expectedMonthlyBookings,
    notes,
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ GET /api/users/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getCurrentUser = async (req, res) => {
  try {
    let user = await models.User.findByPk(req.user.id, {
      attributes: [
        "id",
        "name",
        ["first_name", "firstName"],
        ["last_name", "lastName"],
        "email",
        ["email_verified", "emailVerified"],
        "phone",
        "role",                    // ðŸ‘ˆ importante
        ["is_active", "isActive"], // opcional alias
        "avatar_url",
        "createdAt",
        ["country_code", "countryCode"],
        ["residence_country_code", "countryOfResidenceCode"],
        ["referred_by_influencer_id", "referredByInfluencerId"],
        ["referred_by_code", "referredByCode"],
        ["referred_at", "referredAt"],
        ["last_login_at", "lastLoginAt"],
        ["discount_code_prompted_at", "discountCodePromptedAt"],
        ["discount_code_reminder_at", "discountCodeReminderAt"],
        ["discount_code_locked_at", "discountCodeLockedAt"],
        ["discount_code_entered_at", "discountCodeEnteredAt"],
        ["hotel_pricing_tier", "hotelPricingTier"],
        ["hotel_pricing_request_status", "hotelPricingRequestStatus"],
        ["hotel_pricing_request_data", "hotelPricingRequestData"],
        ["hotel_pricing_requested_at", "hotelPricingRequestedAt"],
        ["hotel_pricing_reviewed_at", "hotelPricingReviewedAt"],
        ["hotel_pricing_reviewed_by_user_id", "hotelPricingReviewedByUserId"],
        ["hotel_pricing_note", "hotelPricingNote"],
        ["referral_credit_total_minor", "referralCreditTotalMinor"],
        ["referral_credit_available_minor", "referralCreditAvailableMinor"],
        ["referral_credit_used_minor", "referralCreditUsedMinor"],
        ["referral_credit_granted_at", "referralCreditGrantedAt"],
        ["referral_credit_expires_at", "referralCreditExpiresAt"],
        ["referral_credit_source_influencer_id", "referralCreditSourceInfluencerId"],
        ["referral_credit_source_code", "referralCreditSourceCode"],
        "user_code",
      ],
      include: [
        { model: models.HostProfile, as: "hostProfile" },
        { model: models.GuestProfile, as: "guestProfile" },
      ],
    })
    if (!user) return res.status(404).json({ error: "User not found" })
    await ensureDiscountCodeLock(user)
    if (shouldTouchLastLogin(user.last_login_at)) {
      user = await user.update({ last_login_at: new Date() })
    }
    const plain = user.get({ plain: true })
    const derivedName = resolveNameParts({
      name: plain.name,
      firstName: plain.firstName,
      lastName: plain.lastName,
    })
    if (!plain.firstName && derivedName.firstName) plain.firstName = derivedName.firstName
    if (!plain.lastName && derivedName.lastName) plain.lastName = derivedName.lastName
    if (!plain.name && derivedName.fullName) plain.name = derivedName.fullName
    plain.roleCodes = deriveRoleCodes(plain)
    plain.hotelPricingTier = plain.hotelPricingTier ?? plain.hotel_pricing_tier ?? null
    plain.hotelPricingRequestStatus = plain.hotelPricingRequestStatus ?? plain.hotel_pricing_request_status ?? null
    plain.hotelPricingRequestData = plain.hotelPricingRequestData ?? plain.hotel_pricing_request_data ?? null
    plain.hotelPricingRequestedAt = plain.hotelPricingRequestedAt ?? plain.hotel_pricing_requested_at ?? null
    plain.hotelPricingReviewedAt = plain.hotelPricingReviewedAt ?? plain.hotel_pricing_reviewed_at ?? null
    plain.hotelPricingReviewedByUserId =
      plain.hotelPricingReviewedByUserId ?? plain.hotel_pricing_reviewed_by_user_id ?? null
    plain.hotelPricingNote = plain.hotelPricingNote ?? plain.hotel_pricing_note ?? null

    const referralLinked = Boolean(
      plain.referredByInfluencerId ??
        plain.referred_by_influencer_id ??
        plain.referredByCode ??
        plain.referred_by_code
    )
    if (referralLinked) {
      const paidCount = models.Booking
        ? await models.Booking.count({
            where: {
              user_id: plain.id,
              payment_status: { [Op.in]: ["PAID", "REFUNDED"] },
            },
          })
        : 0
      const status = paidCount > 0 ? "used" : "available"
      const pct = referralFirstBookingPct()
      plain.referralFirstBookingStatus = status
      plain.referralFirstBookingDiscountPct = pct
      plain.referralFirstBooking = {
        status,
        pct,
      }
    }
    return res.json(plain)
  } catch (err) {
    console.error("Error getting current user:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const requestHotelPricingTier = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const payload = normalizeHotelPricingRequestData(req.body || {})
    if (!payload.fullName || !payload.agencyCompanyName || !payload.phone || !payload.expectedMonthlyBookings) {
      return res.status(400).json({
        error:
          "Full name, agency/company name, phone and expected monthly bookings are required.",
      })
    }

    const result = await sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!user) throw new Error("User not found")
      if (Number(user.role) === 10 || String(user.hotel_pricing_tier || "").toUpperCase() === "TRAVEL_AGENT") {
        const err = new Error("Travel agent pricing is already active.")
        err.status = 409
        throw err
      }

      await user.update(
        {
          hotel_pricing_request_status: "pending",
          hotel_pricing_request_data: {
            fullName: payload.fullName,
            agencyCompanyName: payload.agencyCompanyName,
            phone: payload.phone,
            expectedMonthlyBookings: payload.expectedMonthlyBookings,
            notes: payload.notes || null,
          },
          hotel_pricing_requested_at: new Date(),
          hotel_pricing_note: null,
        },
        { transaction }
      )

      return user.reload({ transaction })
    })

    return res.json({
      message: "Travel agent pricing request submitted",
      user: result,
    })
  } catch (err) {
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message })
    }
    console.error("requestHotelPricingTier error:", err)
    return res.status(500).json({ error: "Unable to submit travel agent pricing request" })
  }
}

export const approveHotelPricingTier = async (req, res) => {
  try {
    const adminUserId = Number(req.user?.id)
    if (!adminUserId) return res.status(401).json({ error: "Unauthorized" })

    const targetUserId = Number(req.params?.userId || req.params?.id || 0)
    if (!targetUserId) return res.status(400).json({ error: "Missing userId" })

    const note = normalizeNamePart(req.body?.note ?? req.body?.reason ?? null)

    const result = await sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(targetUserId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!user) throw new Error("User not found")

      await user.update(
        {
          hotel_pricing_tier: "TRAVEL_AGENT",
          hotel_pricing_request_status: "approved",
          hotel_pricing_reviewed_at: new Date(),
          hotel_pricing_reviewed_by_user_id: adminUserId,
          hotel_pricing_note: note || null,
        },
        { transaction }
      )

      return user.reload({ transaction })
    })

    return res.json({
      message: "Travel agent pricing approved",
      user: result,
    })
  } catch (err) {
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    console.error("approveHotelPricingTier error:", err)
    return res.status(500).json({ error: "Unable to approve travel agent pricing" })
  }
}

export const rejectHotelPricingTier = async (req, res) => {
  try {
    const adminUserId = Number(req.user?.id)
    if (!adminUserId) return res.status(401).json({ error: "Unauthorized" })

    const targetUserId = Number(req.params?.userId || req.params?.id || 0)
    if (!targetUserId) return res.status(400).json({ error: "Missing userId" })

    const note = normalizeNamePart(req.body?.note ?? req.body?.reason ?? null)

    const result = await sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(targetUserId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!user) throw new Error("User not found")
      if (Number(user.role) === 10 || String(user.hotel_pricing_tier || "").toUpperCase() === "TRAVEL_AGENT") {
        const err = new Error("Travel agent pricing is already active.")
        err.status = 409
        throw err
      }

      await user.update(
        {
          hotel_pricing_request_status: "rejected",
          hotel_pricing_reviewed_at: new Date(),
          hotel_pricing_reviewed_by_user_id: adminUserId,
          hotel_pricing_note: note || null,
        },
        { transaction }
      )

      return user.reload({ transaction })
    })

    return res.json({
      message: "Travel agent pricing rejected",
      user: result,
    })
  } catch (err) {
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    if (err.status === 409) {
      return res.status(409).json({ error: err.message })
    }
    console.error("rejectHotelPricingTier error:", err)
    return res.status(500).json({ error: "Unable to reject travel agent pricing" })
  }
}

/* ----------------------- GET /api/users/lookup ----------------------- */
export const lookupUserByEmail = async (req, res) => {
  try {
    const email = String(req.query?.email || "").trim().toLowerCase()
    if (!email) return res.status(400).json({ error: "Email is required" })
    if (!isValidEmail(email)) return res.status(400).json({ error: "Invalid email" })

    const user = await models.User.findOne({
      where: sequelize.where(
        sequelize.fn("lower", sequelize.col("email")),
        email,
      ),
      attributes: ["id", "name", "email", "avatar_url"],
    })

    if (!user) return res.json({ user: null })

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatar_url ?? null,
      },
    })
  } catch (err) {
    console.error("lookupUserByEmail:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PUT /api/users/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const updateUserProfile = async (req, res) => {
  try {
    const { name, firstName, lastName, email, phone, countryCode, countryOfResidenceCode } = req.body
    const userId = req.user.id

    // Validaciones bÃ¡sicas
    const resolvedName = resolveNameParts({ name, firstName, lastName })
    if (!resolvedName.fullName || !email) {
      return res.status(400).json({ error: "Name and email are required" })
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" })
    }

    // Validar que el email no estÃ© en uso por otro usuario
    const existingUser = await models.User.findOne({
      where: {
        email,
        id: { [Op.ne]: userId }, // â† Usar Op importado directamente
      },
    })

    if (existingUser) {
      return res.status(400).json({ error: "Email already in use" })
    }

    // Validar telÃ©fono si se proporciona
    if (phone && phone.trim()) {
      const phoneRegex = /^\+?[0-9\s\-()]{10,15}$/
      if (!phoneRegex.test(phone.replace(/\s/g, ""))) {
        return res.status(400).json({ error: "Invalid phone number format" })
      }
    }

    // Validar y normalizar códigos de país (opcionales)
    const normalizeCode = (value) => {
      if (value === undefined || value === null || value === "") return null
      const trimmed = String(value).trim()
      if (!/^\d+$/.test(trimmed)) {
        throw new Error("Country codes must be numeric")
      }
      return trimmed
    }

    let normalizedCountryCode = null
    let normalizedResidenceCode = null
    try {
      normalizedCountryCode = normalizeCode(countryCode)
      normalizedResidenceCode = normalizeCode(countryOfResidenceCode)
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message })
    }

    // Actualizar usuario
    const [updatedRowsCount] = await models.User.update(
      {
        name: resolvedName.fullName,
        first_name: resolvedName.firstName,
        last_name: resolvedName.lastName,
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
        country_code: normalizedCountryCode,
        residence_country_code: normalizedResidenceCode,
      },
      {
        where: { id: userId },
        returning: true,
      },
    )

    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: "User not found" })
    }

    // Obtener usuario actualizado
    const updatedUser = await models.User.findByPk(userId, {
      attributes: [
        "id",
        "name",
        ["first_name", "firstName"],
        ["last_name", "lastName"],
        "email",
        "phone",
        "role",
        "avatar_url",
        "createdAt",
        ["is_active", "isActive"],
        ["country_code", "countryCode"],
        ["residence_country_code", "countryOfResidenceCode"],
        ["last_login_at", "lastLoginAt"],
        ["discount_code_prompted_at", "discountCodePromptedAt"],
        ["discount_code_reminder_at", "discountCodeReminderAt"],
        ["discount_code_locked_at", "discountCodeLockedAt"],
        ["discount_code_entered_at", "discountCodeEnteredAt"],
        "user_code",
      ],
    })

    return res.json({
      message: "Profile updated successfully",
      user: updatedUser,
    })
  } catch (err) {
    console.error("Error updating user profile:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PUT /api/users/me/password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const userId = req.user.id

    // Validaciones bÃ¡sicas
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" })
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters long" })
    }

    // Obtener usuario con contraseÃ±a
    const user = await models.User.findByPk(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: "Password not set for this account" })
    }

    // Verificar contraseÃ±a actual
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }

    // Verificar que la nueva contraseÃ±a sea diferente
    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash)
    if (isSamePassword) {
      return res.status(400).json({ error: "New password must be different from current password" })
    }

    // Hashear nueva contraseÃ±a
    const saltRounds = 12
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds)

    // Actualizar contraseÃ±a
    await user.update({ password_hash: newPasswordHash })

    return res.json({ message: "Password changed successfully" })
  } catch (err) {
    console.error("Error changing password:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DELETE /api/users/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const deleteAccount = async (req, res) => {
  try {
    const { password } = req.body
    const userId = req.user.id

    // Validar que se proporcione la contraseÃ±a
    if (!password) {
      return res.status(400).json({ error: "Password is required to delete account" })
    }

    // Obtener usuario
    const user = await models.User.findByPk(userId)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verificar contraseÃ±a
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Incorrect password" })
    }

    // Verificar si el usuario tiene bookings activos
    const activeBookings = await models.Booking.findAll({
      where: {
        user_id: userId,
        status: ["pending", "confirmed"],
        checkOut: { [Op.gte]: new Date() }, // â† Usar Op importado directamente
      },
    })

    if (activeBookings.length > 0) {
      return res.status(400).json({
        error: "Cannot delete account with active bookings. Please cancel or complete your bookings first.",
      })
    }

    // En lugar de eliminar completamente, desactivar la cuenta
    await models.User.update(
      {
        isActive: false,
        email: `deleted_${Date.now()}_${user.email}`, // Para evitar conflictos de email Ãºnico
      },
      { where: { id: userId } },
    )

    return res.json({ message: "Account deleted successfully" })
  } catch (err) {
    console.error("Error deleting account:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

export const becomeHost = async (req, res) => {
  const userId = req.user.id
  const {
    biography,
    languages,
    phoneNumber,
    supportEmail,
    timezone,
    metadata,
  } = req.body || {}

  try {
    const result = await sequelize.transaction(async (t) => {
      const user = await models.User.findByPk(userId, { transaction: t, lock: t.LOCK.UPDATE })
      if (!user) throw new Error("User not found")

      // Keep existing privileged roles (e.g. influencer) and only promote regular users.
      if (Number(user.role || 0) === 0) {
        await user.update({ role: 6 }, { transaction: t })
      }

      const normalizedLanguages = Array.isArray(languages)
        ? languages
        : languages
          ? [languages]
          : undefined

      const [profile, created] = await models.HostProfile.findOrCreate({
        where: { user_id: userId },
        defaults: {
          user_id: userId,
          biography: biography ?? null,
          languages: normalizedLanguages ?? [],
          phone_number: phoneNumber ?? null,
          support_email: supportEmail ?? null,
          timezone: timezone ?? null,
          metadata: metadata ?? null,
        },
        transaction: t,
      })

      const profileUpdates = {}
      if (biography !== undefined) profileUpdates.biography = biography
      if (normalizedLanguages !== undefined) profileUpdates.languages = normalizedLanguages
      if (phoneNumber !== undefined) profileUpdates.phone_number = phoneNumber
      if (supportEmail !== undefined) profileUpdates.support_email = supportEmail
      if (timezone !== undefined) profileUpdates.timezone = timezone
      if (metadata !== undefined) profileUpdates.metadata = metadata

      if (!created && Object.keys(profileUpdates).length) {
        await profile.update(profileUpdates, { transaction: t })
      }

      return user.reload({
        include: [{ model: models.HostProfile, as: "hostProfile" }],
        transaction: t,
      })
    })

    return res.json({
      message: "Host profile ready",
      user: result,
    })
  } catch (err) {
    console.error("Error creating host profile:", err)
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    return res.status(500).json({ error: "Unable to create host profile" })
  }
}

export const becomeInfluencer = async (req, res) => {
  const userId = Number(req.user?.id)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  try {
    const result = await sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!user) throw new Error("User not found")

      // Preserve privileged roles and only promote regular users.
      if (Number(user.role || 0) === 0) {
        await user.update({ role: 2 }, { transaction })
      }

      await ensureInfluencerUserCode({ user, transaction })
      const guestProfile = await ensureInfluencerGuestProfile({ userId, transaction })
      if (guestProfile) {
        const guestProfilePlain =
          typeof guestProfile.get === "function"
            ? guestProfile.get({ plain: true })
            : guestProfile
        const nextMetadata = ensureInfluencerOnboardingMetadata(guestProfilePlain)
        await guestProfile.update({ metadata: nextMetadata }, { transaction })
      }

      return models.User.findByPk(userId, {
        attributes: [
          "id",
          "name",
          "email",
          "role",
          "user_code",
          "avatar_url",
          "email_verified",
        ],
        include: [
          { model: models.HostProfile, as: "hostProfile" },
          { model: models.GuestProfile, as: "guestProfile" },
        ],
        transaction,
      })
    })

    return res.json({
      message: "Influencer profile ready",
      user: result,
    })
  } catch (err) {
    console.error("Error creating influencer profile:", err)
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    return res.status(500).json({ error: "Unable to activate influencer profile" })
  }
}

export const updateInfluencerCode = async (req, res) => {
  const userId = Number(req.user?.id)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  const submittedCode = normalizeInfluencerCode(req.body?.code || req.body?.userCode)
  if (!isValidInfluencerCode(submittedCode)) {
    return res.status(400).json({
      error: `Code must be ${INFLUENCER_CODE_MIN_LENGTH}-${INFLUENCER_CODE_MAX_LENGTH} characters (letters and numbers only).`,
      code: "INFLUENCER_CODE_INVALID",
    })
  }

  try {
    const result = await sequelize.transaction(async (transaction) => {
      const user = await models.User.findByPk(userId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      })
      if (!user) throw new Error("User not found")

      const duplicate = await findUserByInfluencerCode({
        code: submittedCode,
        transaction,
      })
      if (duplicate && Number(duplicate.id) !== Number(userId)) {
        const err = new Error("Code already in use")
        err.code = "INFLUENCER_CODE_DUPLICATE"
        throw err
      }

      const currentCode = normalizeInfluencerCode(user.user_code)
      if (currentCode !== submittedCode) {
        await user.update({ user_code: submittedCode }, { transaction })
      }

      return models.User.findByPk(userId, {
        attributes: [
          "id",
          "name",
          "email",
          "role",
          "user_code",
          "avatar_url",
          "email_verified",
        ],
        include: [
          { model: models.HostProfile, as: "hostProfile" },
          { model: models.GuestProfile, as: "guestProfile" },
        ],
        transaction,
      })
    })

    return res.json({
      message: "Ambassador code updated",
      code: submittedCode,
      user: result,
    })
  } catch (err) {
    if (err.message === "User not found") {
      return res.status(404).json({ error: "User not found" })
    }
    if (err.code === "INFLUENCER_CODE_DUPLICATE") {
      return res.status(409).json({
        error: "This code is already in use. Please choose another one.",
        code: "INFLUENCER_CODE_DUPLICATE",
      })
    }

    console.error("Error updating influencer code:", err)
    return res.status(500).json({ error: "Unable to update ambassador code" })
  }
}

export const createInfluencerIdentityVerificationSession = async (req, res) => {
  const userId = Number(req.user?.id)
  if (!userId) return res.status(401).json({ error: "Unauthorized" })

  try {
    const stripe = await getStripeClient()
    if (!stripe) {
      return res.status(500).json({
        error: "Identity verification is temporarily unavailable.",
        code: "INFLUENCER_IDENTITY_UNAVAILABLE",
      })
    }

    const guestProfile = await ensureInfluencerGuestProfile({ userId, transaction: null })
    if (!guestProfile) {
      return res.status(404).json({ error: "Guest profile not found." })
    }

    const guestProfilePlain =
      typeof guestProfile.get === "function"
        ? guestProfile.get({ plain: true })
        : guestProfile
    const metadata = asPlainObject(guestProfilePlain.metadata)
    if (isInfluencerIdentityVerified(guestProfilePlain)) {
      return res.json({
        sessionId:
          metadata?.influencerIdentityVerification?.sessionId ||
          metadata?.influencer_identity_verification?.sessionId ||
          null,
        status: "verified",
        url: null,
        clientSecret: null,
        expiresAt: null,
      })
    }

    const params = {
      type: "document",
      options: {
        document: {
          require_matching_selfie: true,
        },
      },
      metadata: {
        influencerId: String(userId),
        userId: String(userId),
        flow: "influencer_verify_identity",
      },
    }
    const returnUrl =
      normalizeInfluencerIdentityReturnUrl(req.body?.returnUrl) ||
      resolveInfluencerIdentityReturnUrl()
    if (returnUrl) params.return_url = returnUrl

    const session = await stripe.identity.verificationSessions.create(params)
    const nextMetadata = ensureInfluencerOnboardingMetadata({
      ...metadata,
      influencerIdentityVerification: {
        ...asPlainObject(metadata.influencerIdentityVerification),
        sessionId: session.id,
        status: session.status || "requires_input",
        lastCreatedAt: new Date().toISOString(),
      },
    })

    await guestProfile.update({
      metadata: nextMetadata,
    })

    return res.json({
      sessionId: session.id,
      status: session.status || "requires_input",
      url: session.url || null,
      clientSecret: session.client_secret || null,
      expiresAt: session.expires_at || null,
    })
  } catch (error) {
    console.error(
      "createInfluencerIdentityVerificationSession error:",
      error?.raw?.message || error?.message || error
    )
    return res.status(500).json({
      error: "Unable to start identity verification right now.",
      code: "INFLUENCER_IDENTITY_SESSION_ERROR",
    })
  }
}

export const getInfluencerStats = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const role = Number(req.user?.role) // 2 = influencer

    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2) return res.status(403).json({ error: "Only influencers can access this endpoint" })

    // 1) Traer codigos del influencer
    const codes = await models.DiscountCode.findAll({
      where: { user_id: userId },
      attributes: ["id", "code", "percentage", "special_discount_price", "times_used", "stay_id", "created_at"],
      order: [["created_at", "DESC"]],
    })

    // 2) Conteo de Usuarios Referidos (Signups)
    const signupsCount = await models.User.count({
      where: { referred_by_influencer_id: userId }
    })

    // 3) Traer IDs de usuarios referidos para buscar sus bookings
    const referredUsers = await models.User.findAll({
      where: { referred_by_influencer_id: userId },
      attributes: ["id"]
    })
    const referredUserIds = referredUsers.map(u => u.id)

    // 3b) Asegurar comisión de signup para cada referido (idempotente)
    if (referredUserIds.length && models.InfluencerEventCommission) {
      const existingSignupEvents = await models.InfluencerEventCommission.findAll({
        where: {
          influencer_user_id: userId,
          event_type: "signup",
          signup_user_id: { [Op.in]: referredUserIds },
        },
        attributes: ["signup_user_id"],
      })
      const existingSignupIds = new Set(existingSignupEvents.map((row) => Number(row.signup_user_id)))
      const missingSignupIds = referredUserIds.filter((id) => !existingSignupIds.has(Number(id)))
      if (missingSignupIds.length) {
        for (const signupId of missingSignupIds) {
          try {
            await recordInfluencerEvent({
              eventType: "signup",
              influencerUserId: userId,
              signupUserId: signupId,
              currency: "USD",
            })
          } catch (err) {
            console.warn("Failed to backfill signup commission", { influencerUserId: userId, signupId, err: err?.message })
          }
        }
      }
    }

    // a) bookings enlazadas explicitamente por DiscountCode.stay_id
    const bookingIdsFromCodes = codes
      .map(c => c.stay_id)
      .filter(id => Number.isInteger(id))

    // b) bookings enlazadas por FK en Booking.discount_code_id
    const codeIds = codes.map(c => c.id).filter(id => Number.isInteger(id))

    const bookingConditions = [
      { influencer_user_id: userId },
      ...(referredUserIds.length ? [{ user_id: { [Op.in]: referredUserIds } }] : []),
      ...(bookingIdsFromCodes.length ? [{ id: { [Op.in]: bookingIdsFromCodes } }] : []),
      ...(codeIds.length ? [{ discount_code_id: { [Op.in]: codeIds } }] : []),
    ]

    // 4) Traer bookings confirmadas asociadas
    const bookings = bookingConditions.length
      ? await models.Booking.findAll({
        where: { status: "CONFIRMED", [Op.or]: bookingConditions },
        order: [["created_at", "DESC"]],
        limit: 200,
      })
      : []

    // 5) Sumar comisiones (booking + eventos signup/booking)
    const unpaidByCurrency = {}
    const paidByCurrency = {}

    const addEarning = (ccy, amt, status) => {
      const currency = (ccy || "USD").toUpperCase()
      const amount = Number(amt)
      if (!Number.isFinite(amount)) return

      const targetMap = (status === "paid") ? paidByCurrency : unpaidByCurrency
      targetMap[currency] = (targetMap[currency] || 0) + amount
    }

    // Eventos signup/booking (bonos planos)
    if (models.InfluencerEventCommission) {
      const eventRows = await models.InfluencerEventCommission.findAll({
        where: {
          influencer_user_id: userId,
          status: { [Op.in]: ["eligible", "hold", "paid"] },
        },
        attributes: ["amount", "currency", "status"],
        limit: 1000,
      })
      eventRows.forEach((row) => addEarning(row.currency, row.amount, row.status))
    }

    const incentives = await loadInfluencerIncentives(userId)

    // 6) Normalizar ultimas reservas
    const recentBookings = bookings.slice(0, 20).map((b) => ({
      id: b.id,
      hotelName: b.hotel_name ?? b.hotel ?? null,
      checkIn: b.check_in ?? null,
      checkOut: b.check_out ?? null,
      amount: Number(b.gross_price ?? 0),
      currency: b.currency || "USD",
      status: b.status,
      payoutStatus: b.payout_status ?? null,
    }))

    const totalNights = bookings.reduce((sum, b) => {
      const nights = Number(b?.nights)
      return Number.isFinite(nights) && nights > 0 ? sum + nights : sum
    }, 0)

    // 7) Respuesta
    return res.json({
      user: { id: userId, name: req.user?.name, email: req.user?.email, user_code: req.user?.user_code, role },
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        percentage: c.percentage,
        special_discount_price: c.special_discount_price,
        times_used: c.times_used ?? 0,
        stay_id: c.stay_id ?? null,
      })),
      totals: {
        signupsCount,
        bookingsCount: totalNights,
        bookingsTotal: bookings.length,
        unpaidEarnings: unpaidByCurrency,
        paidEarnings: paidByCurrency,
      },
      recentBookings,
      incentives,
    })
  } catch (err) {
    console.error("Error loading influencer stats:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// GET /api/users/me/influencer/goals
export const getInfluencerGoals = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const role = Number(req.user?.role)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2) return res.status(403).json({ error: "Only influencers can access this endpoint" })

    const incentives = await loadInfluencerIncentives(userId)
    return res.json({
      goals: incentives.goals ?? [],
      wallet: incentives.wallet ?? null,
      redemptions: incentives.redemptions ?? {},
    })
  } catch (err) {
    console.error("Error loading influencer goals:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

const ROLE_MAP = {
  INFLUENCER: { code: 2, label: "Influencer" },
  CORPORATE: { code: 3, label: "Corporate" },
  AGENCY: { code: 4, label: "Agency" },
  STAFF_OPERATOR: { code: 5, label: "Vault Operator" },
  OPERATOR: { code: 5, label: "Vault Operator" },
}

const isEmail = (s = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim())

const sanitize = (v) => String(v ?? "").toString().slice(0, 500)

export const requestPartnerInfo = async (req, res) => {
  try {
    const {
      requestedRoleKey,   // "INFLUENCER" | "CORPORATE" | "AGENCY"
      requestedRole,      // 2 | 3 | 4  (opcional; se valida contra el key)
      userId = null,
      name = "",
      email = "",
    } = req.body || {}


    // Validaciones bÃ¡sicas
    if (!requestedRoleKey || !ROLE_MAP[requestedRoleKey]) {
      return res.status(400).json({ error: "Invalid requestedRoleKey" })
    }
    if (!email || !isEmail(email)) {
      return res.status(400).json({ error: "Valid email is required" })
    }

    const role = ROLE_MAP[requestedRoleKey]
    if (requestedRole && Number(requestedRole) !== role.code) {
      // No es fatal, pero lo normalizamos
      // (tambiÃ©n podrÃ­as rechazar con 400)
    }

    const to = "ramiro.alet@gmail.com"
    const from = "partners@insiderbookings.com"

    const cleanName = sanitize(name)
    const cleanEmail = sanitize(email)
    const ua = sanitize(req.headers["user-agent"] || "")
    const ip = sanitize(
      (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString()
    )

    const subject = `Partner Information Request â€” ${role.label}`
    const text = [
      `New partner info request`,
      ``,
      `Role: ${role.label} (${requestedRoleKey}/${role.code})`,
      `Name: ${cleanName}`,
      `Email: ${cleanEmail}`,
      `User ID: ${userId ?? "-"}`,
      ``,
      `IP: ${ip}`,
      `UA: ${ua}`,
      ``,
      `Sent at: ${new Date().toISOString()}`,
    ].join("\n")

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 8px">New partner information request</h2>
        <p style="margin:0 0 12px;color:#374151">
          A user asked for more details about the <strong>${role.label}</strong> program.
        </p>
        <table style="border-collapse:collapse">
          <tbody>
            <tr><td style="padding:6px 12px;color:#6b7280">Role</td><td style="padding:6px 12px"><strong>${role.label}</strong> (${requestedRoleKey}/${role.code})</td></tr>
            <tr><td style="padding:6px 12px;color:#6b7280">Name</td><td style="padding:6px 12px">${cleanName || "-"}</td></tr>
            <tr><td style="padding:6px 12px;color:#6b7280">Email</td><td style="padding:6px 12px">${cleanEmail}</td></tr>
            <tr><td style="padding:6px 12px;color:#6b7280">User ID</td><td style="padding:6px 12px">${userId ?? "-"}</td></tr>
          </tbody>
        </table>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0" />
        <p style="margin:0 0 4px;color:#6b7280;font-size:12px">
          IP: ${ip} â€¢ UA: ${ua}
        </p>
        <p style="margin:0;color:#6b7280;font-size:12px">Sent at ${new Date().toISOString()}</p>
      </div>
    `

    await sendMail({ to, from, subject, text, html })

    return res.json({
      ok: true,
      message: "Email sent. You will receive information from our team shortly.",
    })
  } catch (err) {
    console.error("partner.request-info mail error:", err)
    return res.status(500).json({ error: "Could not send email" })
  }
}

// GET /api/users/me/influencer/commissions
export const getInfluencerCommissions = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const role = Number(req.user?.role)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2) return res.status(403).json({ error: "Only influencers can access this endpoint" })

    const { status = "all" } = req.query
    const where = { influencer_user_id: userId }
    if (["hold", "eligible", "paid", "reversed"].includes(String(status))) where.status = status

    const rows = await models.InfluencerEventCommission.findAll({
      where,
      include: [
        { model: models.Stay, as: "stay" },
        { model: models.User, as: "signupUser", attributes: ["id", "name", "email"] },
      ],
      order: [["created_at", "DESC"]],
      limit: 500,
    })

    return res.json({ items: rows })
  } catch (err) {
    console.error("getInfluencerCommissions:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// POST /api/users/admin/influencer/payouts/create
export const adminCreateInfluencerPayoutBatch = async (req, res) => {
  try {
    const role = Number(req.user?.role)
    if (role !== 100) return res.status(403).json({ error: "Forbidden" })

    const { ids = [] } = req.body || {}
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" })
    }

    const result = await processInfluencerPayoutBatch({
      limit: Math.max(1, ids.length),
      eventIds: ids,
    })

    return res.json(result)
  } catch (err) {
    console.error("adminCreateInfluencerPayoutBatch:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// GET /api/users (used for referrals)
export const getInfluencerReferrals = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    const role = Number(req.user?.role)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2 && role !== 100) return res.status(403).json({ error: "Forbidden" })

    // Buscar usuarios referidos por este influencer
    const referrals = await models.User.findAll({
      where: { referred_by_influencer_id: userId },
      attributes: [
        "id",
        "name",
        "email",
        "createdAt",
      ],
      order: [["createdAt", "DESC"]],
      limit: 500,
    })

    const referralIds = referrals.map((referral) => Number(referral.id)).filter((id) => Number.isFinite(id))
    const bookingCountsByUserId = new Map()

    if (referralIds.length) {
      const bookingCounts = await models.Booking.findAll({
        where: {
          user_id: { [Op.in]: referralIds },
          status: "CONFIRMED",
        },
        attributes: [
          "user_id",
          [sequelize.fn("COUNT", sequelize.col("id")), "bookingsCount"],
        ],
        group: ["user_id"],
        raw: true,
      })

      bookingCounts.forEach((row) => {
        const id = Number(row?.user_id)
        if (!Number.isFinite(id)) return
        bookingCountsByUserId.set(id, Number(row?.bookingsCount || 0))
      })
    }

    const results = referrals.map((u) => {
      const plainUser = u.get({ plain: true })
      return {
        ...plainUser,
        bookingsCount: bookingCountsByUserId.get(Number(u.id)) || 0,
      }
    })

    return res.json(results)
  } catch (err) {
    console.error("getInfluencerReferrals error:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// POST /api/users/me/discount-code/status
export const recordDiscountCodeStatus = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const stage = String(req.body?.stage || "").trim().toLowerCase()
    if (!stage || !["initial", "reminder"].includes(stage)) {
      return res.status(400).json({ error: "Invalid discount code status" })
    }

    let user = await models.User.findByPk(userId)
    if (!user) return res.status(404).json({ error: "User not found" })

    user = await ensureDiscountCodeLock(user)
    if (user.discount_code_locked_at) {
      return res.status(403).json({ error: "Discount codes are no longer available" })
    }
    if (user.referred_by_influencer_id || user.referred_by_code || user.discount_code_entered_at) {
      return res.status(409).json({ error: "Discount code already applied" })
    }

    const now = new Date()
    if (stage == "initial") {
      if (!user.discount_code_prompted_at) {
        user = await user.update({ discount_code_prompted_at: now })
      }
    } else {
      const updates = {}
      if (!user.discount_code_prompted_at) updates.discount_code_prompted_at = now
      if (!user.discount_code_reminder_at) updates.discount_code_reminder_at = now
      if (Object.keys(updates).length) {
        user = await user.update(updates)
      }
    }

    return res.json({
      discountCodePromptedAt: user.discount_code_prompted_at ?? null,
      discountCodeReminderAt: user.discount_code_reminder_at ?? null,
      discountCodeLockedAt: user.discount_code_locked_at ?? null,
    })
  } catch (err) {
    console.error("recordDiscountCodeStatus error:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

// POST /api/users/me/discount-code
export const applyDiscountCode = async (req, res) => {
  try {
    const userId = Number(req.user?.id)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const codeRaw = req.body?.code
    const code = normalizeDiscountCode(codeRaw)
    if (!code) return res.status(400).json({ error: "Discount code is required" })

    let user = await models.User.findByPk(userId)
    if (!user) return res.status(404).json({ error: "User not found" })

    user = await ensureDiscountCodeLock(user)
    if (user.discount_code_locked_at) {
      return res.status(403).json({ error: "Discount codes are no longer available" })
    }
    if (user.referred_by_influencer_id || user.referred_by_code || user.discount_code_entered_at) {
      return res.status(409).json({ error: "Discount code already applied" })
    }

    try {
      await linkReferralCodeForUser({ userId, referralCode: code })
      user = await models.User.findByPk(userId)
    } catch (err) {
      if (err instanceof ReferralError) {
        return res.status(err.status).json({ error: err.message })
      }
      throw err
    }

    return res.json({
      referredByInfluencerId: user?.referred_by_influencer_id ?? null,
      referredByCode: user?.referred_by_code ?? null,
      referredAt: user?.referred_at ?? null,
      discountCodeEnteredAt: user?.discount_code_entered_at ?? null,
    })
  } catch (err) {
    console.error("applyDiscountCode error:", err)
    return res.status(500).json({ error: "Server error" })
  }
}


