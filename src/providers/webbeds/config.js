const toNumberOr = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const getWebbedsConfig = (overrides = {}) => {
  const {
    WEBBEDS_USERNAME,
    WEBBEDS_PASSWORD_MD5,
    WEBBEDS_PASSWORD,
    WEBBEDS_COMPANY_ID,
    WEBBEDS_HOST,
    WEBBEDS_TIMEOUT_MS,
    WEBBEDS_RETRIES,
  } = process.env

  const config = {
    username: overrides.username ?? WEBBEDS_USERNAME,
    passwordMd5: overrides.passwordMd5 ?? WEBBEDS_PASSWORD_MD5,
    password: overrides.password ?? WEBBEDS_PASSWORD,
    companyCode: overrides.companyCode ?? WEBBEDS_COMPANY_ID,
    host: overrides.host ?? WEBBEDS_HOST ?? "https://xmldev.dotwconnect.com",
    timeoutMs: overrides.timeoutMs ?? toNumberOr(WEBBEDS_TIMEOUT_MS, 30000),
    retries: overrides.retries ?? toNumberOr(WEBBEDS_RETRIES, 2),
  }

  if (!config.username) throw new Error("Missing WebBeds username (WEBBEDS_USERNAME)")
  if (!config.companyCode) throw new Error("Missing WebBeds company code (WEBBEDS_COMPANY_ID)")
  if (!config.host) throw new Error("Missing WebBeds host (WEBBEDS_HOST)")

  return config
}
