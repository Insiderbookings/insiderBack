import { quoteTGX } from "./services/booking.service.js"
import { getMarkup } from "../../utils/markup.js"

export const quote = async (req, res, next) => {
  console.log(req.body, "bod")
  try {
    const { rateKey } = req.body
    if (!rateKey) return res.status(400).json({ error: "rateKey required" })

    const settings = {
      client: process.env.TGX_CLIENT,
      context: process.env.TGX_CONTEXT,
      timeout: 10000,
      testMode: true,
    }

    // helpers (align with search controller)
    const moneyRound = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
    const applyMarkup = (amount, pct) => {
      const n = Number(amount)
      if (!Number.isFinite(n)) return null
      return moneyRound(n * (1 + pct))
    }
    // role resolution: prefer authenticated user; otherwise force guest
    const jwtRole = req.user?.role ?? req.user?.role_id
    const roleNum = Number.isFinite(Number(jwtRole)) ? Number(jwtRole) : 0

    const data = await quoteTGX(rateKey, settings)
    const net = Number(data?.price?.net)
    const pct = getMarkup(roleNum, net)
    const priceUser = applyMarkup(net, pct)

    // headers to help FE debug/alignment
    res.set("x-markup-role", String(roleNum))
    res.set("x-markup-pct", String(pct))

    res.json({ ...data, priceUser, markup: { roleNum, pct } })
  } catch (err) {
    next(err)
  }
}



