// src/services/referralRewards.service.js
import { Op } from "sequelize"
import models, { sequelize } from "../models/index.js"

const allowedEvents = new Set(["signup", "booking"])

export class ReferralError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const normalizeCode = (value) => String(value || "").trim().toUpperCase()

const parseFxRates = () => {
  try {
    const rates = JSON.parse(process.env.FX_USD_RATES || "{}")
    if (rates && typeof rates === "object") return rates
  } catch { }
  return {}
}

const toCurrencyFromUsd = (usdAmount, currency) => {
  if (!currency || String(currency).toUpperCase() === "USD") return usdAmount
  const rates = parseFxRates()
  const rate = Number(rates[String(currency).toUpperCase()])
  if (!Number.isFinite(rate) || rate <= 0) return usdAmount
  return usdAmount * rate
}

const referralCouponPct = () => {
  const pctEnv = Number(process.env.REFERRAL_COUPON_PCT)
  return Number.isFinite(pctEnv) && pctEnv > 0 ? pctEnv : 10
}

const referralCouponCapUsd = () => {
  const capEnv = Number(process.env.REFERRAL_COUPON_MAX_USD)
  return Number.isFinite(capEnv) && capEnv > 0 ? capEnv : null
}

const signupBonusAmount = (upgraded = false) => {
  const envKey = upgraded
    ? "INFLUENCER_SIGNUP_BOOKING_BONUS_USD"
    : "INFLUENCER_SIGNUP_BONUS_USD"
  const env = Number(process.env[envKey])
  const fallback = upgraded ? 1 : 0.5
  return Number.isFinite(env) && env > 0 ? env : fallback
}

const bookingBonusPerNightUsd = () => {
  const env = Number(process.env.INFLUENCER_BOOKING_BONUS_USD)
  return Number.isFinite(env) && env > 0 ? env : 2
}

const parseNights = (nights, checkIn, checkOut) => {
  const n = Number(nights)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  if (!checkIn || !checkOut) return null
  const inDate = new Date(checkIn)
  const outDate = new Date(checkOut)
  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) return null
  const ms = outDate.getTime() - inDate.getTime()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  return days > 0 ? days : null
}

const getStaySnapshot = async (stayId, transaction) => {
  if (!stayId || !models.Stay) return null
  return models.Stay.findByPk(stayId, {
    attributes: ["id", "nights", "check_in", "check_out", "currency"],
    transaction,
  })
}

const ensureWallet = async (influencerUserId, transaction) => {
  if (!models.CouponWallet) return null
  const [wallet] = await models.CouponWallet.findOrCreate({
    where: { influencer_user_id: influencerUserId },
    defaults: { total_granted: 0, total_used: 0 },
    transaction,
  })
  return wallet
}

export const walletAvailability = async (influencerUserId, transaction) => {
  const wallet = await ensureWallet(influencerUserId, transaction)
  if (!wallet) return { wallet: null, available: 0, pending: 0 }

  const pending = await models.CouponRedemption.count({
    where: { coupon_wallet_id: wallet.id, status: { [Op.in]: ["pending"] } },
    transaction,
  })
  const granted = Number(wallet.total_granted || 0)
  const used = Number(wallet.total_used || 0)
  const available = Math.max(0, granted - used - pending)
  return { wallet, available, pending }
}

const computeReferralDiscount = (totalBeforeDiscount, currency) => {
  const pct = referralCouponPct()
  if (!pct) return 0
  const rawDiscount = Number.parseFloat(((totalBeforeDiscount * pct) / 100).toFixed(2))
  const capUsd = referralCouponCapUsd()
  if (!capUsd) return rawDiscount
  const capInCurrency = toCurrencyFromUsd(capUsd, currency)
  if (!Number.isFinite(capInCurrency)) return rawDiscount
  return Math.min(rawDiscount, Number.parseFloat(capInCurrency.toFixed(2)))
}

export const findInfluencerByReferralCode = async (code, transaction) => {
  if (!models.User) return null
  const normalized = normalizeCode(code)
  if (!normalized) return null
  const where = {
    role: 2,
    user_code: { [Op.iLike]: normalized },
  }
  const influencer = await models.User.findOne({
    where,
    attributes: ["id", "user_code", "name", "email"],
    transaction,
  })
  return influencer
}

const ensureEventCommission = async ({
  eventType,
  influencerUserId,
  signupUserId = null,
  stayId = null,
  nights = null,
  currency = "USD",
  transaction,
}) => {
  if (!models.InfluencerEventCommission) return null
  if (!influencerUserId) return null
  const where = { event_type: eventType, influencer_user_id: influencerUserId }
  if (eventType === "signup") where.signup_user_id = signupUserId
  if (eventType === "booking") where.stay_id = stayId

  let amount = 0
  let amountCurrency = (currency || "USD").toUpperCase()
  if (eventType === "signup") {
    amount = signupBonusAmount(false)
    amountCurrency = "USD"
  } else {
    let stay = null
    const stayNights = parseNights(nights, null, null)
    if (!stayNights) {
      stay = await getStaySnapshot(stayId, transaction)
    }
    const resolvedNights = stayNights || parseNights(stay?.nights, stay?.check_in, stay?.check_out)
    if (!resolvedNights) return null
    const perNightUsd = bookingBonusPerNightUsd()
    const totalUsd = perNightUsd * resolvedNights
    const resolvedCurrency = (currency || stay?.currency || "USD").toUpperCase()
    amount = toCurrencyFromUsd(totalUsd, resolvedCurrency)
    amountCurrency = resolvedCurrency
  }
  if (!amount) return null
  if (Number.isFinite(amount)) {
    amount = Number.parseFloat(amount.toFixed(2))
  }

  const [commission] = await models.InfluencerEventCommission.findOrCreate({
    where,
    defaults: {
      influencer_user_id: influencerUserId,
      signup_user_id: signupUserId || null,
      stay_id: stayId || null,
      event_type: eventType,
      amount,
      currency: amountCurrency,
      status: "eligible",
    },
    transaction,
  })
  return commission
}

const grantGoalReward = async (goal, influencerUserId, transaction) => {
  if (!goal || !goal.reward_type) return null
  const now = new Date()
  if (goal.reward_type === "coupon_grant") {
    const count = Math.max(0, Math.floor(Number(goal.reward_value || 0)))
    if (!count) return null
    const wallet = await ensureWallet(influencerUserId, transaction)
    if (wallet) {
      await wallet.increment("total_granted", { by: count, transaction })
    }
    return { type: "coupon_grant", count, granted_at: now }
  }

  if (goal.reward_type === "cash") {
    const amount = Number(goal.reward_value || 0)
    if (!amount || !models.InfluencerEventCommission) return null
    const commission = await models.InfluencerEventCommission.create(
      {
        influencer_user_id: influencerUserId,
        event_type: goal.event_type === "booking" ? "booking" : "signup",
        amount,
        currency: (goal.reward_currency || "USD").toUpperCase(),
        status: "eligible",
      },
      { transaction }
    )
    return { type: "cash", amount, commissionId: commission.id, granted_at: now }
  }
  return null
}

const bumpGoalProgress = async ({ eventType, influencerUserId, transaction }) => {
  if (!models.InfluencerGoal || !models.InfluencerGoalProgress) return
  const goals = await models.InfluencerGoal.findAll({
    where: { event_type: eventType, is_active: true },
    transaction,
  })
  for (const goal of goals) {
    const [progress] = await models.InfluencerGoalProgress.findOrCreate({
      where: { goal_id: goal.id, influencer_user_id: influencerUserId },
      defaults: { progress_count: 0 },
      transaction,
    })

    await progress.increment("progress_count", { by: 1, transaction })
    await progress.update({ last_event_at: new Date() }, { transaction })
    await progress.reload({ transaction })

    if (!progress.reward_granted_at && progress.progress_count >= goal.target_count) {
      const reward = await grantGoalReward(goal, influencerUserId, transaction)
      const updates = { completed_at: progress.completed_at || new Date() }
      if (reward?.granted_at) updates.reward_granted_at = reward.granted_at
      if (reward?.commissionId) updates.reward_commission_id = reward.commissionId
      await progress.update(updates, { transaction })
    }
  }
}

export const recordInfluencerEvent = async ({
  eventType,
  influencerUserId,
  signupUserId = null,
  stayId = null,
  nights = null,
  currency = "USD",
  transaction,
}) => {
  if (!allowedEvents.has(eventType) || !influencerUserId || !models.InfluencerGoalEvent) {
    return { skipped: true }
  }
  const where = { event_type: eventType, influencer_user_id: influencerUserId }
  if (eventType === "signup") where.signup_user_id = signupUserId || null
  if (eventType === "booking") where.stay_id = stayId || null

  const [event, created] = await models.InfluencerGoalEvent.findOrCreate({
    where,
    defaults: { occurred_at: new Date() },
    transaction,
  })

  if (created) {
    await bumpGoalProgress({ eventType, influencerUserId, transaction })
  }

  const commission = await ensureEventCommission({
    eventType,
    influencerUserId,
    signupUserId,
    stayId,
    nights,
    currency,
    transaction,
  })

  return { event, created, commission }
}

export const upgradeSignupBonusOnBooking = async ({
  influencerUserId,
  bookingUserId,
  transaction,
}) => {
  if (!models.InfluencerEventCommission || !models.User) return null
  if (!influencerUserId || !bookingUserId) return null
  const user = await models.User.findByPk(bookingUserId, {
    attributes: ["id", "referred_by_influencer_id"],
    transaction,
  })
  if (!user) return null
  if (Number(user.referred_by_influencer_id) !== Number(influencerUserId)) return null

  const existing = await models.InfluencerEventCommission.findOne({
    where: {
      influencer_user_id: influencerUserId,
      event_type: "signup",
      signup_user_id: bookingUserId,
    },
    transaction,
  })
  if (!existing) return null
  if (existing.status === "paid") return existing

  const targetAmount = signupBonusAmount(true)
  const currentAmount = Number(existing.amount || 0)
  if (!Number.isFinite(currentAmount) || currentAmount >= targetAmount) return existing

  await existing.update({ amount: targetAmount, currency: "USD" }, { transaction })
  return existing
}

export const linkReferralCodeForUser = async ({ userId, referralCode, transaction }) => {
  const code = normalizeCode(referralCode)
  if (!code) throw new ReferralError("Referral code is required", 400)

  const user = await models.User.findByPk(userId, { transaction })
  if (!user) throw new ReferralError("User not found", 404)

  if (user.referred_by_influencer_id) {
    if (normalizeCode(user.referred_by_code) === code) {
      return { user, influencerId: user.referred_by_influencer_id, alreadyLinked: true }
    }
    throw new ReferralError("User already linked to an influencer", 409)
  }

  const influencer = await findInfluencerByReferralCode(code, transaction)
  if (!influencer) throw new ReferralError("Invalid referral code", 404)
  if (Number(influencer.id) === Number(userId)) {
    throw new ReferralError("You cannot use your own code", 400)
  }

  const now = new Date()
  const updates = {
    referred_by_influencer_id: influencer.id,
    referred_by_code: code,
    referred_at: now,
  }
  if (!user.discount_code_entered_at) updates.discount_code_entered_at = now
  await user.update(updates, { transaction })

  await recordInfluencerEvent({
    eventType: "signup",
    influencerUserId: influencer.id,
    signupUserId: user.id,
    currency: "USD",
    transaction,
  })

  return { user, influencerId: influencer.id, alreadyLinked: false }
}

export const planReferralCoupon = async ({
  influencerUserId,
  userId,
  totalBeforeDiscount,
  currency = "USD",
  transaction,
}) => {
  if (!influencerUserId || !models.CouponWallet || !models.CouponRedemption) return { apply: false }
  const { wallet, available, pending } = await walletAvailability(influencerUserId, transaction)
  if (!wallet || available <= 0) return { apply: false, wallet, available, pending }

  const discountAmount = computeReferralDiscount(totalBeforeDiscount, currency)
  if (!discountAmount || discountAmount <= 0) return { apply: false, wallet, available, pending }

  return {
    apply: true,
    wallet,
    available,
    pending,
    discountAmount: Number.parseFloat(discountAmount.toFixed(2)),
    currency: (currency || "USD").toUpperCase(),
    influencerUserId,
    userId,
  }
}

export const createPendingRedemption = async ({ plan, stayId, transaction }) => {
  if (!plan?.apply || !plan.wallet) return null
  const defaults = {
    coupon_wallet_id: plan.wallet.id,
    influencer_user_id: plan.influencerUserId,
    user_id: plan.userId,
    stay_id: stayId,
    status: "pending",
    discount_amount: plan.discountAmount,
    currency: plan.currency,
    reserved_at: new Date(),
    metadata: { source: "booking_create" },
  }

  const [redemption] = await models.CouponRedemption.findOrCreate({
    where: { stay_id: stayId },
    defaults,
    transaction,
  })

  if (redemption.status === "pending") {
    const needsUpdate =
      redemption.discount_amount !== defaults.discount_amount ||
      redemption.currency !== defaults.currency ||
      !redemption.reserved_at
    if (needsUpdate) {
      await redemption.update(defaults, { transaction })
    }
  }

  return redemption
}

export const finalizeReferralRedemption = async (stayId, transaction) => {
  if (!models.CouponRedemption || !models.CouponWallet) return null
  const redemption = await models.CouponRedemption.findOne({
    where: { stay_id: stayId },
    transaction,
  })
  if (!redemption) return null
  if (redemption.status === "redeemed") return redemption

  const wallet = await models.CouponWallet.findByPk(redemption.coupon_wallet_id, { transaction })
  if (wallet) {
    await wallet.increment("total_used", { by: 1, transaction })
  }

  await redemption.update(
    {
      status: "redeemed",
      redeemed_at: new Date(),
      reserved_at: redemption.reserved_at || new Date(),
    },
    { transaction }
  )
  return redemption
}

export const reverseReferralRedemption = async (stayId, transaction) => {
  if (!models.CouponRedemption || !models.CouponWallet) return null
  const redemption = await models.CouponRedemption.findOne({
    where: { stay_id: stayId },
    transaction,
  })
  if (!redemption) return null
  if (redemption.status === "reversed") return redemption

  const wallet = redemption.coupon_wallet_id
    ? await models.CouponWallet.findByPk(redemption.coupon_wallet_id, { transaction })
    : null

  if (wallet && redemption.status === "redeemed") {
    await wallet.increment("total_used", { by: -1, transaction })
    await wallet.reload({ transaction })
    if (Number(wallet.total_used || 0) < 0) {
      await wallet.update({ total_used: 0 }, { transaction })
    }
  }

  await redemption.update(
    {
      status: "reversed",
      reversed_at: new Date(),
    },
    { transaction }
  )
  return redemption
}

export const loadInfluencerIncentives = async (influencerUserId) => {
  const walletInfo = await walletAvailability(influencerUserId)
  const goals =
    models.InfluencerGoal && models.InfluencerGoalProgress
      ? await models.InfluencerGoal.findAll({
        where: { is_active: true },
        include: [
          {
            model: models.InfluencerGoalProgress,
            as: "progress",
            required: false,
            where: { influencer_user_id: influencerUserId },
          },
        ],
        order: [["id", "ASC"]],
      })
      : []

  const goalSnapshots = goals.map((g) => {
    const progressRow = Array.isArray(g.progress) ? g.progress[0] : null
    return {
      id: g.id,
      code: g.code,
      name: g.name,
      eventType: g.event_type,
      targetCount: g.target_count,
      rewardType: g.reward_type,
      rewardValue: g.reward_value,
      rewardCurrency: g.reward_currency,
      progressCount: progressRow?.progress_count ?? 0,
      completedAt: progressRow?.completed_at ?? null,
      rewardGrantedAt: progressRow?.reward_granted_at ?? null,
    }
  })

  const redemptionStats = models.CouponRedemption
    ? await models.CouponRedemption.findAll({
      where: { influencer_user_id: influencerUserId },
      attributes: ["status", [sequelize.fn("COUNT", sequelize.col("id")), "cnt"]],
      group: ["status"],
    })
    : []

  const redemptionSummary = {}
  redemptionStats.forEach((row) => {
    const plain = row.get ? row.get({ plain: true }) : row
    redemptionSummary[plain.status] = Number(plain.cnt || 0)
  })

  return {
    wallet: {
      totalGranted: walletInfo.wallet?.total_granted ?? 0,
      totalUsed: walletInfo.wallet?.total_used ?? 0,
      pending: walletInfo.pending ?? 0,
      available: walletInfo.available ?? 0,
    },
    goals: goalSnapshots,
    redemptions: redemptionSummary,
  }
}
