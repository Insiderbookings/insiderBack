import bcrypt from "bcrypt"
import models from "../models/index.js"
import { sendMail } from "../helpers/mailer.js"

const ROLE_LABELS = {
  0: "Regular",
  1: "Staff",
  2: "Influencer",
  3: "Corporate",
  4: "Agency",
  5: "Vault operator",
}

const PARTNERS_MAILBOX = process.env.PARTNERS_EMAIL || "ramiro.alet@gmail.com"

/* Helpers portables */
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

export async function createUserRoleRequest(req, res, next) {
  try {
    const userId = req.user?.id
    const { role } = req.body || {}
    const roleNum = Number(role)
    if (!userId) return res.status(401).json({ error: "Unauthorized" })
    if (![1, 2, 3, 4, 5].includes(roleNum)) return res.status(400).json({ error: "Invalid role" })

    const user = await models.User.findByPk(userId, { attributes: ["id", "name", "email", "role"] })
    if (!user) return res.status(404).json({ error: "User not found" })

    const reqRow = await models.UserRoleRequest.create({
      user_id: userId,
      role_requested: roleNum,
      status: "pending",
    })

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
    await sendMail({ to: PARTNERS_MAILBOX, subject, html, text: `${user.email} requested ${ROLE_LABELS[roleNum]}` })

    return res.status(201).json({ request: reqRow })
  } catch (err) { return next(err) }
}

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

export async function submitUserRoleInfo(req, res, next) {
  try {
    const userId = req.user?.id
    const { id } = req.params
    const body = req.body || {}
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow || reqRow.user_id !== userId) return res.status(404).json({ error: "Request not found" })

    await reqRow.update({ form_data: body, status: "submitted" })

    const user = await models.User.findByPk(userId, { attributes: ["email", "name"] })
    const subject = `Role info submitted: ${ROLE_LABELS[reqRow.role_requested]} by ${user?.email}`
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <h2 style="margin:0 0 8px">User submitted role information</h2>
        <p>Role: <strong>${ROLE_LABELS[reqRow.role_requested]}</strong> (${reqRow.role_requested})</p>
        <pre style="background:#f9fafb;padding:12px;border-radius:8px;white-space:pre-wrap">${JSON.stringify(body, null, 2)}</pre>
      </div>
    `
    await sendMail({ to: PARTNERS_MAILBOX, subject, html, text: "User submitted role info" })

    return res.json({ request: reqRow })
  } catch (err) { return next(err) }
}

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

export async function adminApproveFinal(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })

    const user = await models.User.findByPk(reqRow.user_id)
    if (!user) return res.status(404).json({ error: "User not found" })

    // 1) Asigna el rol y limpia pending
    await user.update({ role: reqRow.role_requested, role_pending_info: false })

    // 2) Si es operador de vault, crear/asegurar WcAccount portable
    if (reqRow.role_requested === 5) {
      const Wc = models.WcAccount
      const tenantKey = fieldKey(Wc, "tenant_id", "tenantId")
      const dispKey = fieldKey(Wc, "display_name", "displayName")
      const isActKey = fieldKey(Wc, "is_active", "isActive")
      const passKey = fieldKey(Wc, "password_hash", "passwordHash")
      const rolesKey = fieldKey(Wc, "roles")
      const permsKey = fieldKey(Wc, "permissions")

      // tenant id: preferimos DEFAULT_TENANT_ID_FOR_OPERATORS, fallback DEFAULT_TENANT_ID
      let tenantId = process.env.DEFAULT_TENANT_ID_FOR_OPERATORS || process.env.DEFAULT_TENANT_ID || null
      if (tenantId != null) tenantId = Number(tenantId)

      // where para findOrCreate (si existe tenant_id lo incluimos)
      const where = { email: user.email }
      if (tenantKey && tenantId != null) where[tenantKey] = tenantId

      // password temporal: baseName + 6 dígitos
      const baseName = makeBaseName(user)
      const randomNumber = Math.floor(100000 + Math.random() * 900000)
      const plainPassword = `${baseName}${randomNumber}`
      const hash = await bcrypt.hash(plainPassword, 10)
      const displayName = user.name || user.email.split("@")[0]

      // payload SOLO con columnas existentes en el modelo
      const payload = { email: user.email }
      if (dispKey) payload[dispKey] = displayName
      if (passKey) payload[passKey] = hash
      if (isActKey) payload[isActKey] = true
      if (rolesKey) payload[rolesKey] = coerceArrayField(Wc, rolesKey, ["operator"])
      if (permsKey) payload[permsKey] = coerceArrayField(Wc, permsKey, ["vault:operate"])

      // Validación mínima: si el modelo exige tenant y no tenemos id
   

      try {
        const [__rec, __created] = await Wc.findOrCreate({ where, defaults: payload })
      } catch (e) {
        console.error("WcAccount findOrCreate failed:", e?.parent?.detail || e?.errors?.[0]?.message || e?.message)
        // Propagamos un mensaje más claro
        return res.status(500).json({ error: e?.parent?.detail || e?.errors?.[0]?.message || e?.message })
      }
      // Por seguridad NO devolvemos plainPassword. Si querés, luego lo enviamos por email.
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
