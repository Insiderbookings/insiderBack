import bcrypt from "bcrypt"
import models from "../models/index.js"
import { Op } from "sequelize" // â† Agregar esta importaciÃ³n
import { sendMail } from "../helpers/mailer.js"

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ GET /api/users/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const getCurrentUser = async (req, res) => {
  try {
    const user = await models.User.findByPk(req.user.id, {
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "role",                    // ðŸ‘ˆ importante
        ["is_active", "isActive"], // opcional alias
        "avatar_url",
        "createdAt",
      ],
    })
    if (!user) return res.status(404).json({ error: "User not found" })
    return res.json(user.get({ plain: true }))
  } catch (err) {
    console.error("Error getting current user:", err)
    return res.status(500).json({ error: "Server error" })
  }
}
/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ PUT /api/users/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
export const updateUserProfile = async (req, res) => {
  try {
    const { name, email, phone } = req.body
    const userId = req.user.id

    // Validaciones bÃ¡sicas
    if (!name || !email) {
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

    // Actualizar usuario
    const [updatedRowsCount] = await models.User.update(
      {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone ? phone.trim() : null,
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
  attributes: ["id","name","email","phone","role","avatar_url","createdAt",["is_active","isActive"]],
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

    // Verificar contraseÃ±a actual
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: "Current password is incorrect" })
    }

    // Verificar que la nueva contraseÃ±a sea diferente
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash)
    if (isSamePassword) {
      return res.status(400).json({ error: "New password must be different from current password" })
    }

    // Hashear nueva contraseÃ±a
    const saltRounds = 12
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds)

    // Actualizar contraseÃ±a
    await models.User.update({ passwordHash: newPasswordHash }, { where: { id: userId } })

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

export const getInfluencerStats = async (req, res) => {
  try {
    // En producciÃ³n, obtÃ©n estos datos desde req.user
    const userId = Number(req.user?.id)
    const role = Number(req.user?.role) // 2 = influencer

    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2) return res.status(403).json({ error: "Only influencers can access this endpoint" })

    // 1) Traer cÃ³digos del influencer
    const codes = await models.DiscountCode.findAll({
      where: { user_id: userId },
      attributes: ["id", "code", "percentage", "special_discount_price", "times_used", "booking_id", "created_at"],
      order: [["created_at", "DESC"]],
    })

    if (!codes.length) {
      return res.json({
        user: { id: userId, name: req.user?.name, email: req.user?.email, role },
        codes: [],
        totals: { bookingsCount: 0, unpaidEarnings: {} },
        recentBookings: [],
      })
    }

    // a) bookings enlazadas explÃ­citamente por DiscountCode.booking_id
    const bookingIdsFromCodes = codes
      .map(c => c.booking_id)
      .filter(id => Number.isInteger(id))

    // b) bookings enlazadas por FK en Booking.discount_code_id
    const codeIds = codes.map(c => c.id).filter(id => Number.isInteger(id))

    // 2) Traer bookings confirmadas asociadas (por cualquiera de los dos caminos)
    const whereBooking = {
      status: "CONFIRMED", // coincide con tu ENUM
      [Op.or]: [
        ...(bookingIdsFromCodes.length ? [{ id: { [Op.in]: bookingIdsFromCodes } }] : []),
        ...(codeIds.length ? [{ discount_code_id: { [Op.in]: codeIds } }] : []),
      ],
    }

    // Si por algÃºn motivo no hay or-conditions, devolvemos vacÃ­o de forma segura
    const bookings = (whereBooking[Op.or]?.length)
      ? await models.Booking.findAll({
          where: whereBooking,
          order: [["created_at", "DESC"]],
          limit: 200,
        })
      : []

    // 3) ComisiÃ³n fija USD$5 â€œcappedâ€
    const FLAT_COMMISSION = 5
    const earningsByCurrency = {}

    const eligible = bookings.filter((b) => {
      const pay    = String(b.payment_status ?? "").toUpperCase()    // 'UNPAID' | 'PAID' | 'REFUNDED'
      const payout = String(b.payout_status   ?? "").toUpperCase()    // si tienes este campo
      const paidOk        = ["PAID"].includes(pay)
      const payoutPending = !payout || ["PENDING", "AWAITING", "QUEUED"].includes(payout)
      return paidOk && payoutPending
    })

    for (const b of eligible) {
      const ccy = b.currency || "USD"
      earningsByCurrency[ccy] = (earningsByCurrency[ccy] || 0) + FLAT_COMMISSION
    }

    // 4) Normalizar Ãºltimas reservas para el front
    const recentBookings = bookings.slice(0, 20).map((b) => ({
      id: b.id,
      hotelName: b.hotel_name ?? b.hotel ?? null, // adapta si tienes esta info en otra tabla
      checkIn: b.check_in ?? null,
      checkOut: b.check_out ?? null,
      amount: Number(b.gross_price ?? 0),
      currency: b.currency || "USD",
      status: b.status,
      payoutStatus: b.payout_status ?? null, // si existe la columna
    }))

    // 5) Respuesta
    return res.json({
      user: { id: userId, name: req.user?.name, email: req.user?.email, role },
      codes: codes.map((c) => ({
        id: c.id,
        code: c.code,
        percentage: c.percentage,
        special_discount_price: c.special_discount_price,
        times_used: c.times_used ?? 0,
        booking_id: c.booking_id ?? null,
      })),
      totals: {
        bookingsCount: bookings.length,
        unpaidEarnings: earningsByCurrency,
      },
      recentBookings,
    })
  } catch (err) {
    console.error("Error loading influencer stats:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

const ROLE_MAP = {
  INFLUENCER    : { code: 2, label: "Influencer" },
  CORPORATE     : { code: 3, label: "Corporate"  },
  AGENCY        : { code: 4, label: "Agency"     },
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

    const cleanName  = sanitize(name)
    const cleanEmail = sanitize(email)
    const ua  = sanitize(req.headers["user-agent"] || "")
    const ip  = sanitize(
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
    const role   = Number(req.user?.role)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (role !== 2) return res.status(403).json({ error: "Only influencers can access this endpoint" })

    const { status = "all" } = req.query
    const where = { influencer_user_id: userId }
    if (["hold", "eligible", "paid", "reversed"].includes(String(status))) where.status = status

    const rows = await models.InfluencerCommission.findAll({
      where,
      include: [
        { model: models.Booking, as: "booking" },
        { model: models.DiscountCode, as: "discountCode", attributes: ["id", "code"] },
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

    const { ids = [], payoutBatchId } = req.body || {}
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "ids array required" })
    }

    const batchId = payoutBatchId || `IBP-${Date.now().toString(36)}`
    const { Op } = await import("sequelize")
    const [count] = await models.InfluencerCommission.update(
      { status: "paid", paid_at: new Date(), payout_batch_id: batchId },
      { where: { id: { [Op.in]: ids }, status: { [Op.in]: ["eligible", "hold"] } } }
    )

    return res.json({ updated: count, batchId })
  } catch (err) {
    console.error("adminCreateInfluencerPayoutBatch:", err)
    return res.status(500).json({ error: "Server error" })
  }
}

