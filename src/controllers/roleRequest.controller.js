// src/controllers/roleRequest.controller.js
import bcrypt from "bcrypt"
import { Op } from "sequelize"
import models from "../models/index.js"
import { sendMail } from "../helpers/mailer.js"
import { presignIfS3Url } from '../utils/s3Presign.js'

/* -------------------------- Shared email templates ------------------------- */
function wrapEmail({ title, body, ctaLabel, ctaHref }) {
  const btn = ctaLabel && ctaHref ? `
    <div style="margin-top:16px">
      <a href="${ctaHref}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600">${ctaLabel}</a>
    </div>
  ` : ""
  return `
    <div style=\"font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6;color:#111\">
      <div style=\"max-width:640px;margin:0 auto;padding:20px\">
        <h2 style=\"margin:0 0 12px\">${title}</h2>
        <div style=\"color:#374151\">${body}</div>
        ${btn}
        <hr style=\"border:none;border-top:1px solid #e5e7eb;margin:20px 0\" />
        <div style=\"font-size:12px;color:#6b7280\">Insider Bookings</div>
      </div>
    </div>
  `
}

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
  6: "Host",
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
    if (![1, 2, 3, 4, 5, 6].includes(roleNum)) return res.status(400).json({ error: "Invalid role" })

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
      // Presign S3 URLs before using them in the email
      const idFront = d.govIdFrontUrl ? await presignIfS3Url(d.govIdFrontUrl) : null
      const idBack  = d.govIdBackUrl  ? await presignIfS3Url(d.govIdBackUrl)  : null
      const idUrl   = d.govIdUrl      ? await presignIfS3Url(d.govIdUrl)      : null // legacy single
      const llcUrl  = d.llcArticlesUrl ? await presignIfS3Url(d.llcArticlesUrl) : null
      const einUrl  = d.einLetterUrl   ? await presignIfS3Url(d.einLetterUrl)   : null
      const bankUrl = d.bankDocUrl     ? await presignIfS3Url(d.bankDocUrl)     : null
      const selfieUrl = d.selfieUrl ? await presignIfS3Url(d.selfieUrl) : null
      const frontUrl = idFront || idUrl

      const isBusiness = d.phase === "business" || d.llcArticlesUrl || d.einLetterUrl || d.bankDocUrl
      if (isBusiness) {
        html = `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
            <h2 style="margin:0 0 8px">Vault Operator - Business Information</h2>
            <p>Role: <strong>Vault operator</strong> (5)</p>
            <h3 style="margin:16px 0 6px">Company Information</h3>
            <table style="border-collapse:collapse">
              <tbody>
                <tr><td style="padding:4px 8px;color:#6b7280">Chosen operator name</td><td style="padding:4px 8px">${d.selectedName || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Business address</td><td style="padding:4px 8px">${d.businessAddress || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Business bank</td><td style="padding:4px 8px">${d.businessBank || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Bank routing number</td><td style="padding:4px 8px">${d.businessRoutingNumber || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">LLC Articles</td><td style="padding:4px 8px">${llcUrl ? `<a href="${llcUrl}">View</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">EIN Letter</td><td style="padding:4px 8px">${einUrl ? `<a href="${einUrl}">View</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Bank Document</td><td style="padding:4px 8px">${bankUrl ? `<a href="${bankUrl}">View</a>` : '-'}</td></tr>
              </tbody>
            </table>
            <h3 style="margin:16px 0 6px">Identity verification (Step 2)</h3>
            <table style="border-collapse:collapse">
              <tbody>
                <tr><td style="padding:4px 8px;color:#6b7280">Government ID (front)</td><td style="padding:4px 8px">${frontUrl ? `<a href="${frontUrl}">View front</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Government ID (back)</td><td style="padding:4px 8px">${idBack ? `<a href="${idBack}">View back</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Selfie</td><td style="padding:4px 8px">${selfieUrl ? `<a href="${selfieUrl}">View selfie</a>` : '-'}</td></tr>
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
                <tr><td style="padding:4px 8px;color:#6b7280">Full name</td><td style="padding:4px 8px">${d.fullName || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal email</td><td style="padding:4px 8px">${d.personalEmail || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal phone</td><td style="padding:4px 8px">${d.personalPhone || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">SSN</td><td style="padding:4px 8px">${d.ssn || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Personal address</td><td style="padding:4px 8px">${d.personalAddress || '-'} </td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Government ID (front)</td><td style="padding:4px 8px">${frontUrl ? `<a href="${frontUrl}">View front</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Government ID (back)</td><td style="padding:4px 8px">${idBack ? `<a href="${idBack}">View back</a>` : '-'}</td></tr>
                <tr><td style="padding:4px 8px;color:#6b7280">Selfie</td><td style="padding:4px 8px">${selfieUrl ? `<a href="${selfieUrl}">View selfie</a>` : '-'}</td></tr>
              </tbody>
            </table>
            <h3 style="margin:16px 0 6px">Step 2: Company Name Selection</h3>
            <p>Chosen name: <strong>${d.selectedName || '-'} </strong></p>
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
    try { console.log('[uploadGovId] body keys:', Object.keys(req.body||{}), 'files keys:', req.files ? (Array.isArray(req.files)?`array(${req.files.length})` : Object.keys(req.files)) : 'none') } catch {}
    // Gather possible URLs: legacy single, and new front/back
    let urlSingle =
      uploaded.govIdUrl ||
      req.body?.govIdUrl ||
      req?.file?.location ||
      req?.file?.url ||
      null

    let urlFront =
      uploaded.govIdFrontUrl ||
      req.body?.govIdFrontUrl ||
      req.files?.["gov_id_front"]?.[0]?.location ||
      req.files?.["gov_id_front"]?.[0]?.url ||
      null

    let urlBack =
      uploaded.govIdBackUrl ||
      req.body?.govIdBackUrl ||
      req.files?.["gov_id_back"]?.[0]?.location ||
      req.files?.["gov_id_back"]?.[0]?.url ||
      null

    // Optional selfie field
    const urlSelfie =
      uploaded.selfieUrl ||
      req.body?.selfieUrl ||
      req.files?.["selfie"]?.[0]?.location ||
      req.files?.["selfie"]?.[0]?.url ||
      null

    if (!urlSingle && Array.isArray(req?.files)) {
      const f = req.files[0]
      urlSingle = f?.location || f?.url || null
    }
    if (!urlSingle && req?.files && typeof req.files === "object") {
      const f = req.files["gov_id"]?.[0]
      urlSingle = f?.location || f?.url || null
    }

    // If legacy single provided but neither front/back, map to front for compatibility
    if (!urlFront && !urlBack && urlSingle) urlFront = urlSingle

    if (!urlFront && !urlBack && !urlSelfie) {
      try { console.warn('[uploadGovId] no URLs derived') } catch {}
      return res.status(400).json({ error: "No file uploaded" })
    }

    // Best-effort: persist into the user's latest role-request draft
    try {
      const userId = req.user?.id
      if (userId) {
        const reqRow = await models.UserRoleRequest.findOne({
          where: { user_id: userId },
          order: [["created_at", "DESC"]],
        })
        if (reqRow) {
          const prev = reqRow.form_data || {}
          const merged = { ...prev, phase: prev.phase || "kyc" }
          if (urlFront) merged.govIdFrontUrl = urlFront
          if (urlBack)  merged.govIdBackUrl  = urlBack
          if (urlSelfie) merged.selfieUrl = urlSelfie
          if (!merged.govIdFrontUrl && urlSingle) merged.govIdFrontUrl = urlSingle
          await reqRow.update({ form_data: merged })
        }
      }
    } catch (e) {
      // Do not fail the upload if persisting the draft fails
      console.warn('uploadGovId: persist draft failed:', e?.message || e)
    }

    try { console.log('[uploadGovId] OK', { urlFront, urlBack, urlSelfie, urlSingle }) } catch {}
    return res.json({ govIdFrontUrl: urlFront || undefined, govIdBackUrl: urlBack || undefined, selfieUrl: urlSelfie || undefined, url: urlSingle || undefined })
  } catch (err) { return next(err) }
}

/**
 * POST /users/role-requests/upload-business
 * Devuelve { llcArticlesUrl, einLetterUrl, bankDocUrl } según lo recibido.
 */
export async function uploadBusinessDocs(req, res, next) {
  try {
    const uploaded = res.locals?.uploaded || res.locals?.fields || {}
    try { console.log('[uploadBusinessDocs] body keys:', Object.keys(req.body||{}), 'files keys:', req.files ? (Array.isArray(req.files)?`array(${req.files.length})` : Object.keys(req.files)) : 'none') } catch {}

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
      try { console.warn('[uploadBusinessDocs] no URLs derived') } catch {}
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

    // Notify user to start verification
    try {
      const user = await models.User.findByPk(reqRow.user_id)
      if (user?.email) {
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
        const isHost = Number(reqRow.role_requested) === 6
        const subject = isHost
          ? "Host application: complete verification"
          : "Action required: Complete Step 1 (KYC)"
        const body = isHost
          ? `
            <p>Hi ${user.name || ''},</p>
            <p>Your host application was received. Please complete your verification details so we can review and approve it.</p>
            <p>We need:</p>
            <ul>
              <li>Full name and phone</li>
              <li>Address</li>
              <li>Payout preference</li>
              <li>Tax ID (optional)</li>
            </ul>
            <p>You can follow the status and submit these details from the app or the web portal.</p>
          `
          : `
            <p>Hi ${user.name || ''},</p>
            <p>Your request was pre-approved. You can now complete <strong>Step 1 of 2</strong>: Personal Information & KYC.</p>
            <p>Please upload:</p>
            <ul>
              <li>Full name, personal email and phone</li>
              <li>SSN</li>
              <li>Government-issued ID</li>
              <li>Personal address</li>
            </ul>
            <p>You can track your progress at any time and preview your uploads before submitting.</p>
          `
        const html = wrapEmail({
          title: isHost ? "Host verification required" : "Vault Operator Onboarding - Step 1",
          body,
          ctaLabel: "Open verification",
          ctaHref: `${clientUrl}/complete-info`,
        })
        await sendMail({
          to: user.email,
          subject,
          html,
          text: `${subject}. Continue at ${clientUrl}/complete-info`,
        })
      }
    } catch (e) {
      console.warn('adminApproveInitial: failed to send user mail:', e?.message || e)
    }
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
    if (Number(reqRow.role_requested) === 6) {
      return res.status(409).json({ error: "KYC step not applicable for host" })
    }
    if (reqRow.status !== "submitted") return res.status(409).json({ error: "Request not in submitted state" })

    const fd = Object.assign({}, reqRow.form_data || {})
    if (!fd || (fd.phase !== "kyc" && !fd.fullName)) {
      return res.status(409).json({ error: "KYC phase not detected" })
    }

    fd.kycApprovedAt = safeNowISO()
    fd.phase = "business"

    await reqRow.update({ status: "needs_info", form_data: fd })
    await models.User.update({ role_pending_info: true }, { where: { id: reqRow.user_id } })

    // Notify user Step 1 approved -> proceed to Step 2 (Business)
    try {
      const user = await models.User.findByPk(reqRow.user_id)
      if (user?.email) {
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
        const subject = "KYC approved — Continue with Step 2"
        const body = `
          <p>Hi ${user.name || ''},</p>
          <p>Good news! Your <strong>Step 1 (KYC)</strong> was approved. Please proceed with <strong>Step 2 of 2</strong>: Company information.</p>
          <p>For Step 2, have ready:</p>
          <ul>
            <li>Business address</li>
            <li>Business bank account number</li>
            <li>Bank routing number</li>
            <li>LLC Articles (PDF or image)</li>
            <li>EIN letter (PDF or image)</li>
          </ul>
          <p>You can switch between steps at any time and review what you have uploaded.</p>
        `
        const html = wrapEmail({ title: "Vault Operator — Step 2 Available", body, ctaLabel: "Continue to Step 2", ctaHref: `${clientUrl}/complete-info` })
        await sendMail({ to: user.email, subject, html, text: `KYC approved — continue at ${clientUrl}/complete-info` })
      }
    } catch (e) {
      console.warn('adminApproveKyc: failed to send user mail:', e?.message || e)
    }
    return res.json({ request: reqRow })
  } catch (err) { return next(err) }
}

export async function adminApproveFinal(req, res, next) {
  try {
    const { id } = req.params
    const reqRow = await models.UserRoleRequest.findByPk(id)
    if (!reqRow) return res.status(404).json({ error: "Request not found" })
    if (reqRow.status !== "submitted") return res.status(409).json({ error: "Request not ready for final approval" })

    // Mark as approved early to avoid duplicate emails on double-click
    // A second concurrent call will now fail the status check above.
    await reqRow.update({ status: "approved" })

    const user = await models.User.findByPk(reqRow.user_id)
    if (!user) return res.status(404).json({ error: "User not found" })

    // Actualiza rol
    await user.update({ role: reqRow.role_requested, role_pending_info: false })

    // Si es operator (5), ya no se crean cuentas WcAccount.
    // El operador accederá al panel dentro de InsiderWeb usando su misma cuenta.
    if (Number(reqRow.role_requested) === 5) {
      try {
        if (user?.email) {
          const subject = "Vault Operator - Approved"
          const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
          const body = `
            <p>Hi ${user.name || ''},</p>
            <p><strong>Congratulations!</strong> Your Vault Operator role has been approved.</p>
            <p>You can now access your Operator Panel directly from Insider Bookings using your existing login (no additional account required).</p>
          `
          const html = wrapEmail({ title: "Access your Operator Panel", body, ctaLabel: "Open Operator Panel", ctaHref: `${clientUrl}/operator` })
          await sendMail({ to: user.email, subject, html, text: `Operator role approved. Go to ${clientUrl}/operator` })
        }
      } catch (e) {
        console.warn('adminApproveFinal: failed to send final user mail:', e?.message || e)
      }
    }
    if (Number(reqRow.role_requested) === 6) {
      try {
        if (user?.email) {
          const subject = "Host application approved"
          const clientUrl = process.env.CLIENT_URL || "http://localhost:5173"
          const body = `
            <p>Hi ${user.name || ''},</p>
            <p><strong>Welcome!</strong> Your host application has been approved.</p>
            <p>You can now switch to host mode and access your host tools.</p>
          `
          const html = wrapEmail({ title: "You're now a Host", body, ctaLabel: "Open host tools", ctaHref: `${clientUrl}/` })
          await sendMail({ to: user.email, subject, html, text: `Host role approved. Sign in to start hosting.` })
        }
      } catch (e) {
        console.warn('adminApproveFinal: failed to send host approval mail:', e?.message || e)
      }
    }

    return res.json({ request: reqRow, user: { id: user.id, role: user.role } })
  } catch (err) { return next(err) }
}

export async function adminListUsers(_req, res, next) {
  try {
    const rows = await models.User.findAll({
      attributes: [
        "id",
        "name",
        "email",
        "phone",
        "role",
        "role_pending_info",
        ["is_active", "isActive"],
        "created_at",
      ],
      include: [{
        model: models.WcTenant,
        through: { attributes: [] },
        attributes: ["id", "name"],
        required: false,
      }],
      order: [["created_at", "DESC"]],
      limit: 500,
    })
    const users = rows.map(r => {
      const o = typeof r.toJSON === 'function' ? r.toJSON() : r
      const tenants = Array.isArray(o.WcTenants) ? o.WcTenants.map(t => ({ id: t.id, name: t.name })) : []
      return { id: o.id, name: o.name, email: o.email, phone: o.phone, role: o.role, role_pending_info: o.role_pending_info, isActive: o.isActive, created_at: o.created_at, tenants }
    })
    return res.json({ users })
  } catch (err) { return next(err) }
}
