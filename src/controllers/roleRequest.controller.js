// src/controllers/roleRequest.controller.js
import bcrypt from "bcrypt"
import { Op } from "sequelize"
import models from "../models/index.js"
import { sendMail } from "../helpers/mailer.js"
import { presignIfS3Url } from '../utils/s3Presign.js'

/* ----------------------------- Helpers comunes ---------------------------- */
function fieldKey(model, ...candidates) {
  return candidates.find((k) => model?.rawAttributes?.[k])
}
function coerceArrayField(model, fieldName, arrVal) {
  const typeKey = model?.rawAttributes?.[fieldName]?.type?.key
  if (typeKey === "ARRAY" || typeKey === "JSON" || typeKey === "JSONB") return arrVal
  return JSON.stringify(arrVal)
}
function makeBaseName(user) {
  const raw = (user?.name ?? user?.email?.split("@")[0] ?? "user") + ""
  return raw.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "")
}
function safeNowISO() {
  try { return new Date().toISOString() } catch { return new Date().toString() }
}

const ROLE_LABELS = {
  0: "Regular",
  1: "Staff",
  2: "Influencer",
  3: "Corporate",
  4: "Agency",
  5: "Vault operator",
}

const PARTNERS_MAILBOX = process.env.PARTNERS_EMAIL || "ramiro.alet@gmail.com"

/* ------------------------------- Endpoints ------------------------------- */

/**
 * POST /users/role-requests
 */
export async function createUserRoleRequest(req, res, next) {
  try {
    const userId = req.user?.id
    const { role } = req.body || {}
    const roleNum = Number(role)

    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (![1, 2, 3, 4, 5].includes(roleNum)) return res.status(400).json({ error: "Invalid role" })

    const user = await models.User.findByPk(userId, { attributes: ["id", "name", "email", "role"] })
    if (!user) return res.status(404).json({ error: "User not found" })

    // Reusar última no-finalizada para evitar duplicados
    const existing = await models.UserRoleRequest.findOne({
      where: { user_id: userId, status: { [Op.in]: ["pending", "needs_info", "submitted"] } },
      order: [["created_at", "DESC"]],
    })
    if (existing) return res.status(200).json({ request: existing, duplicate: true })

    const reqRow = await models.UserRoleRequest.create({
      user_id: userId,
      role_requested: roleNum,
      status: "pending",
    })

    // Notificación
    const subject = `New role request: ${ROLE_LABELS[roleNum]} by ${user.email}`
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 8px">New role request</h2>
        <table style="border-collapse:collapse">
          <tbody>
            <tr><td style="padding:6px 12px;color:#6b7280">User</td><td style="padding:6px 12px">${user.name || "-"} (${user.email})</td></tr>
            <tr><td style="padding:6px 12px;color:#6b7280">Requested role</td><td style="padding:6px 12px"><strong>${ROLE_LABELS[roleNum]}</strong> (${roleNum})</td></tr>
            <tr><td style="padding:6px 12px;color:#6b7280">Request ID</td><td style="padding:6px 12px">${reqRow.id}</td></tr>
          </tbody>
        </table>
      </div>
    `
    try {
      await sendMail({ to: PARTNERS_MAILBOX, subject, html, text: `${user.email} requested ${ROLE_LABELS[roleNum]}` })
    } catch (e) {
      // No romper el flujo si el mail falla
      console.warn("sendMail failed (ignored):", e?.message || e)
    }

    return res.status(201).json({ request: reqRow })
  } catch (err) { return next(err) }
}

/**
 * GET /users/role-requests/my-latest
 */
export async function getMyLatestRequest(req, res, next) {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    const latest = await models.UserRoleRequest.findOne({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
    })
    return res.json({ request: latest })
  } catch (err) { return next(err) }
}

/**
 * POST /users/role-requests/:id/submit-info
 * Guarda info del formulario y marca "submitted".
 * Si rol 5 y se elige nombre, lo reserva.
 */
export async function submitUserRoleInfo(req, res, next) {
  try {
    const userId = req.user?.id
    const { id } = req.params
    if (!userId) return res.status(401).json({ error: "Unauthorized" })

    const body = req.body || {}
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow || reqRow.user_id !== userId) {
      return res.status(404).json({ error: "Request not found" })
    }

    // Reservar nombre de operador si aplica (rol 5)
    if (Number(reqRow.role_requested) === 5 && body?.selectedNameId) {
      const nameId = Number(body.selectedNameId)
      const nameRow = await models.VaultOperatorName.findOne({ where: { id: nameId, is_used: false } })
      if (!nameRow) return res.status(409).json({ error: "Selected operator name is no longer available" })
      await nameRow.update({ is_used: true, used_by_request_id: reqRow.id, used_at: new Date() })
      body.selectedName = nameRow.name
    }

    const prev = reqRow.form_data || {}
    const merged = { ...prev, ...body, phase: body.phase || prev.phase || "kyc", submittedAt: safeNowISO() }

    await reqRow.update({ form_data: merged, status: "submitted" })

    // Mail de aviso (sin adjuntos para evitar 403; dejamos enlaces)
    const user = await models.User.findByPk(userId, { attributes: ["email", "name"] })
    const subject = `Role info submitted: ${ROLE_LABELS[reqRow.role_requested]} by ${user?.email}`

    let html
    if (Number(reqRow.role_requested) === 5) {
      const d = merged
      const isBusiness = d.phase === "business" || d.llcArticlesUrl || d.einLetterUrl || d.bankDocUrl
      if (isBusiness) {
        html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
            <h2 style="margin:0 0 8px">Vault Operator – Business Information</h2>
            <p>Role: <strong>Vault operator</strong> (5)</p>
            <h3 style="margin:16px 0 6px">Company Information</h3>
            <table style="border-collapse:collapse">
              <tbody>
                <tr><td style="padding:4px 8px;color:#6b7280">Chosen operator name</td><td style="padding:4px 8px">${d.selectedName || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Business address</td><td style="padding:4px 8px">${d.businessAddress || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Business bank</td><td style="padding:4px 8px">${d.businessBank || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">LLC Articles</td><td style="padding:4px 8px">${llcUrl ? `<a href="${llcUrl}">View</a>` : "-"}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">EIN Letter</td><td style="padding:4px 8px">${einUrl ? `<a href="${einUrl}">View</a>` : "-"}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Bank Document</td><td style="padding:4px 8px">${bankUrl ? `<a href="${bankUrl}">View</a>` : "-"}</td></tr>
              </tbody>
            </table>
          </div>`
      } else {
        html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
            <h2 style="margin:0 0 8px">Vault Operator information</h2>
            <p>Role: <strong>Vault operator</strong> (5)</p>
            <h3 style="margin:16px 0 6px">Step 1: Personal Information & KYC</h3>
            <table style="border-collapse:collapse">
              <tbody>
                <tr><td style="padding:4px 8px;color:#6b7280">Full name</td><td style="padding:4px 8px">${d.fullName || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal email</td><td style="padding:4px 8px">${d.personalEmail || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal phone</td><td style="padding:4px 8px">${d.personalPhone || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">SSN</td><td style="padding:4px 8px">${d.ssn || '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Government ID</td><td style="padding:4px 8px">${d.govIdUrl ? `<a href="${d.govIdUrl}">View ID</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal address</td><td style="padding:4px 8px">${d.personalAddress || '-'}</td></tr>
              </tbody>
            </table>
            <h3 style="margin:16px 0 6px">Step 2: Company Name Selection</h3>
            <p>Chosen name: <strong>${d.selectedName || '-'}</strong></p>
          </div>`
      }
    } else {
      html = `<div>User submitted role info</div>`
    }

    try {
      await sendMail({ to: PARTNERS_MAILBOX, subject, html, text: "User submitted role info" })
    } catch (e) {
      console.warn("sendMail failed (ignored):", e?.message || e)
    }

    return res.json({ ok: true, request: reqRow })
      // Presign S3 URLs for email links
      const llcUrl  = d.llcArticlesUrl ? await presignIfS3Url(d.llcArticlesUrl) : null
      const einUrl  = d.einLetterUrl   ? await presignIfS3Url(d.einLetterUrl)   : null
      const bankUrl = d.bankDocUrl     ? await presignIfS3Url(d.bankDocUrl)     : null
  } catch (err) { return next(err) }
}

/**
 * GET /users/role-requests/vault-operator/names
 * Lista nombres disponibles (no usados).
 */
export async function listVaultOperatorNames(_req, res, next) {
  try {
    const items = await models.VaultOperatorName.findAll({
      where: { is_used: false },
      attributes: ["id", "name"],
      order: [["name", "ASC"]],
      limit: 500,
    })
    return res.json({ items })
  } catch (err) { return next(err) }
}

/**
 * POST /users/role-requests/upload-id
 * Devuelve { url } del archivo subido (middleware lo genera).
 */
export async function uploadGovId(req, res, next) {
  try {
    const uploaded = res.locals?.uploaded || res.locals?.fields || {}
    let url =
      uploaded.govIdUrl ||
      req.body?.govIdUrl ||
      req?.file?.location ||
      req?.file?.url ||
      null

    if (!url && Array.isArray(req?.files)) {
      const f = req.files[0]
      url = f?.location || f?.url || null
    }
    if (!url && req?.files && typeof req.files === "object") {
      const f = req.files["gov_id"]?.[0]
      url = f?.location || f?.url || null
    }

    if (!url) return res.status(400).json({ error: "No file uploaded" })
    return res.json({ url })
  } catch (err) { return next(err) }
}

/**
 * POST /users/role-requests/upload-business
 * Devuelve { llcArticlesUrl, einLetterUrl, bankDocUrl } según lo recibido.
 */
export async function uploadBusinessDocs(req, res, next) {
  try {
    const uploaded = res.locals?.uploaded || res.locals?.fields || {}

    const result = {
      llcArticlesUrl:
        uploaded.llcArticlesUrl ||
        req.body?.llcArticlesUrl ||
        req.files?.llc_articles?.[0]?.location ||
        req.files?.llc_articles?.[0]?.url ||
        undefined,
      einLetterUrl:
        uploaded.einLetterUrl ||
        req.body?.einLetterUrl ||
        req.files?.ein_letter?.[0]?.location ||
        req.files?.ein_letter?.[0]?.url ||
        undefined,
      bankDocUrl:
        uploaded.bankDocUrl ||
        req.body?.bankDocUrl ||
        req.files?.bank_doc?.[0]?.location ||
        req.files?.bank_doc?.[0]?.url ||
        undefined,
    }

    if (!result.llcArticlesUrl && !result.einLetterUrl && !result.bankDocUrl) {
      return res.status(400).json({ error: "No files uploaded" })
    }

    return res.json(result)
  } catch (err) { return next(err) }
}

/* -------------------- Admin: list / approve / reject -------------------- */

export async function adminListRoleRequests(_req, res, next) {
  try {
    const items = await models.UserRoleRequest.findAll({
      include: [{ model: models.User, as: "user", attributes: ["id", "email", "name", "role", "role_pending_info"] }],
      order: [["created_at", "DESC"]],
      limit: 500,
    })
    return res.json({ items })
  } catch (err) { return next(err) }
}

export async function adminApproveInitial(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })
    await reqRow.update({ status: "needs_info" })
    await models.User.update({ role_pending_info: true }, { where: { id: reqRow.user_id } })
    return res.json({ request: reqRow })
  } catch (err) { return next(err) }
}

export async function adminRejectRequest(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })
    await reqRow.update({ status: "rejected" })
    await models.User.update({ role_pending_info: false }, { where: { id: reqRow.user_id } })
    return res.json({ request: reqRow })
  } catch (err) { return next(err) }
}

export async function adminApproveKyc(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })
    if (reqRow.status !== "submitted") return res.status(409).json({ error: "Request not in submitted state" })

    const fd = Object.assign({}, reqRow.form_data || {})
    if (!fd || (fd.phase !== "kyc" && !fd.fullName)) {
      return res.status(409).json({ error: "KYC phase not detected" })
    }

    fd.kycApprovedAt = safeNowISO()
    fd.phase = "business"

    await reqRow.update({ status: "needs_info", form_data: fd })
    await models.User.update({ role_pending_info: true }, { where: { id: reqRow.user_id } })
    return res.json({ request: reqRow })
  } catch (err) { return next(err) }
}

export async function adminApproveFinal(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })
    if (reqRow.status !== "submitted") return res.status(409).json({ error: "Request not ready for final approval" })

    const user = await models.User.findByPk(reqRow.user_id)
    if (!user) return res.status(404).json({ error: "User not found" })

    // Actualiza rol
    await user.update({ role: reqRow.role_requested, role_pending_info: false })

    // Si es operator (5), crear cuenta en WcAccount + enviar credenciales
    if (Number(reqRow.role_requested) === 5) {
      const Wc = models.WcAccount
      const dispKey = fieldKey(Wc, "display_name", "displayName")
      const isActKey = fieldKey(Wc, "is_active", "isActive")
      const passKey = fieldKey(Wc, "password_hash", "passwordHash")
      const rolesKey = fieldKey(Wc, "roles")
      const permsKey = fieldKey(Wc, "permissions")

      const baseName = makeBaseName(user)
      const rnd = Math.floor(100000 + Math.random() * 900000)
      const plainPassword = `${baseName}${rnd}`
      const hash = await bcrypt.hash(plainPassword, 10)
      const displayName = user.name || user.email.split("@")[0]

      const where = { email: user.email }
      const payload = { email: user.email }
      if (dispKey) payload[dispKey] = displayName
      if (passKey) payload[passKey] = hash
      if (isActKey) payload[isActKey] = true
      if (rolesKey) payload[rolesKey] = coerceArrayField(Wc, rolesKey, ["operator"])
      if (permsKey) payload[permsKey] = coerceArrayField(Wc, permsKey, ["vault:operate"])

      try {
        const [rec, created] = await Wc.findOrCreate({ where, defaults: payload })
        if (created && user?.email) {
          try {
            await sendMail({
              to: user.email,
              subject: "Your WebConstructor operator account",
              text: `Your operator account has been created.
Login: ${user.email}
Password: ${plainPassword}`,
              html: `
                <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
                  <h3 style="margin:0 0 8px">Welcome to the operator panel</h3>
                  <p>Your account has been created for operating virtual cards.</p>
                  <table style="border-collapse:collapse;margin:12px 0 16px">
                    <tbody>
                      <tr><td style="padding:6px 12px;color:#6b7280">Login</td><td style="padding:6px 12px">${user.email}</td></tr>
                      <tr><td style="padding:6px 12px;color:#6b7280">Temporary password</td><td style="padding:6px 12px"><strong>${plainPassword}</strong></td></tr>
                    </tbody>
                  </table>
                  <p style="color:#6b7280">Please sign in and change your password immediately.</p>
                </div>
              `,
            })
          } catch (mailErr) {
            console.warn("Failed to send operator credentials:", mailErr?.message || mailErr)
          }
        }
      } catch (e) {
        return res.status(500).json({ error: e?.message || "Failed to create operator account" })
      }
    }

    await reqRow.update({ status: "approved" })
    return res.json({ request: reqRow, user: { id: user.id, role: user.role } })
  } catch (err) { return next(err) }
}

export async function adminListUsers(_req, res, next) {
  try {
    const users = await models.User.findAll({
      attributes: ["id", "name", "email", "phone", "role", "role_pending_info", ["is_active", "isActive"], "created_at"],
      order: [["created_at", "DESC"]],
      limit: 500,
    })
    return res.json({ users })
  } catch (err) { return next(err) }
}
