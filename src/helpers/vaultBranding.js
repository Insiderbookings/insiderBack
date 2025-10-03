import { Op } from "sequelize"
import models from "../models/index.js"

const DEFAULT_BRAND = {
  brandName: "Insider Bookings",
  fromName: "Insider Bookings",
}

const cache = new Map()

const sanitizeEmail = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return re.test(trimmed) ? trimmed : null
}

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (typeof value === "string") {
      const v = value.trim()
      if (v) return v
    }
  }
  return null
}

const normalizeList = (input) => {
  if (!input) return undefined
  if (Array.isArray(input)) {
    const list = input.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    return list.length ? list : undefined
  }
  if (typeof input === "string") {
    const list = input
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
    return list.length ? list : undefined
  }
  return undefined
}

const domainVariants = (domain) => {
  const variants = new Set()
  if (!domain) return variants
  const trimmed = domain.trim().toLowerCase()
  if (!trimmed) return variants
  variants.add(trimmed)
  if (trimmed.startsWith("www.")) {
    variants.add(trimmed.slice(4))
  } else {
    variants.add(`www.${trimmed}`)
  }
  return Array.from(variants)
}

export async function resolveVaultBranding({ tenantDomain, fallbackName, fallbackEmail, overrides = {} } = {}) {
  const key = (tenantDomain || "").trim().toLowerCase()
  if (cache.has(key)) {
    return { ...DEFAULT_BRAND, ...cache.get(key), ...(overrides || {}) }
  }

  let tenant = null
  if (key) {
    const variants = domainVariants(key)
    if (variants.length) {
      tenant = await models.WcTenant.findOne({
        where: {
          [Op.or]: [
            { public_domain: { [Op.in]: variants } },
            { panel_domain: { [Op.in]: variants } },
          ],
        },
        include: [{ model: models.WcSiteConfig }],
      })
    }
  }

  const siteConfig = tenant?.WcSiteConfig || null
  const settings = siteConfig && typeof siteConfig.templateSettings === "object" ? siteConfig.templateSettings : {}
  const mailer = settings && typeof settings.mailer === "object" ? settings.mailer : {}

  const brandName = firstNonEmpty(mailer.brandName, settings.brandName, tenant?.name, fallbackName, DEFAULT_BRAND.brandName)
  const fromEmailRaw = sanitizeEmail(firstNonEmpty(mailer.fromEmail, settings.fromEmail, fallbackEmail))
  const replyTo = sanitizeEmail(firstNonEmpty(mailer.replyTo, settings.replyTo, overrides.replyTo))
  const primaryColor = firstNonEmpty(mailer.primaryColor, siteConfig?.primaryColor, settings.primaryColor, overrides.primaryColor)
  const accentColor = firstNonEmpty(mailer.accentColor, siteConfig?.secondaryColor, settings.accentColor, overrides.accentColor)
  const logoUrl = firstNonEmpty(mailer.logoUrl, settings.logoUrl, siteConfig?.logoUrl, overrides.logoUrl)
  const backgroundColor = firstNonEmpty(mailer.backgroundColor, settings.backgroundColor, overrides.backgroundColor)
  const bodyBackground = firstNonEmpty(mailer.bodyBackground, settings.bodyBackground, overrides.bodyBackground)
  const textColor = firstNonEmpty(mailer.textColor, overrides.textColor)
  const headerAlign = firstNonEmpty(mailer.headerAlign, overrides.headerAlign)
  const headerTitle = firstNonEmpty(mailer.headerTitle, overrides.headerTitle)
  const headerSubtitle = firstNonEmpty(mailer.headerSubtitle, settings.headerSubtitle, overrides.headerSubtitle)
  const tagline = firstNonEmpty(mailer.tagline, settings.tagline, overrides.tagline)
  const footerText = firstNonEmpty(mailer.footerText, settings.footerText, overrides.footerText)
  const supportText = firstNonEmpty(mailer.supportText, settings.supportText, overrides.supportText)
  const subjectPrefix = firstNonEmpty(mailer.subjectPrefix, brandName)
  const subjectTemplate = firstNonEmpty(mailer.subjectTemplate, overrides.subjectTemplate)
  const introText = firstNonEmpty(mailer.introText, overrides.introText)
  const footerIntroText = firstNonEmpty(mailer.footerIntroText, overrides.footerIntroText)
  const pdfTagline = firstNonEmpty(mailer.pdfTagline, overrides.pdfTagline)
  const pdfFooterText = firstNonEmpty(mailer.pdfFooterText, overrides.pdfFooterText)
  const rateLabel = firstNonEmpty(mailer.rateLabel, overrides.rateLabel)
  const taxLabel = firstNonEmpty(mailer.taxLabel, overrides.taxLabel)
  const totalLabel = firstNonEmpty(mailer.totalLabel, overrides.totalLabel)
  const paymentLabel = firstNonEmpty(mailer.paymentLabel, overrides.paymentLabel)
  const headerExtraHtml = firstNonEmpty(mailer.headerExtraHtml, overrides.headerExtraHtml)
  const footerExtraHtml = firstNonEmpty(mailer.footerExtraHtml, overrides.footerExtraHtml)

  const branding = {
    brandName,
    fromName: firstNonEmpty(mailer.fromName, overrides.fromName, brandName),
    fromEmail: fromEmailRaw,
    replyTo,
    subjectPrefix,
    subjectTemplate,
    introText,
    footerIntroText,
    primaryColor,
    accentColor,
    logoUrl,
    tagline,
    headerTitle,
    headerSubtitle,
    footerText,
    supportText,
    backgroundColor,
    bodyBackground,
    textColor,
    headerAlign,
    headerExtraHtml,
    footerExtraHtml,
    pdfTagline,
    pdfFooterText,
    rateLabel,
    taxLabel,
    totalLabel,
    paymentLabel,
    socialLinks: Array.isArray(mailer.socialLinks) ? mailer.socialLinks : undefined,
    attachCertificate: mailer.attachCertificate,
    cc: normalizeList(mailer.cc || overrides.cc),
    bcc: normalizeList(mailer.bcc || overrides.bcc),
  }

  if (!fromEmailRaw && process.env.MAIL_FROM) {
    branding.fromEmail = process.env.MAIL_FROM
  }

  if (key) cache.set(key, branding)
  return { ...DEFAULT_BRAND, ...branding, ...(overrides || {}) }
}
