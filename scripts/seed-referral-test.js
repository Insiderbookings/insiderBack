// seeds referral test data: influencer + wallet + referred user
import "dotenv/config"
import bcrypt from "bcrypt"
import models, { sequelize } from "../src/models/index.js"
import { linkReferralCodeForUser } from "../src/services/referralRewards.service.js"

const PASSWORD = "Password123!"
const INFLUENCER_EMAIL = process.env.REF_TEST_INFLUENCER_EMAIL || "influencer.test@example.com"
const INFLUENCER_CODE = process.env.REF_TEST_INFLUENCER_CODE || "INFTEST1"
const USER_EMAIL = process.env.REF_TEST_USER_EMAIL || "referral.user@example.com"
const WALLET_GRANT = Number(process.env.REF_TEST_WALLET_GRANT || 5)

async function ensurePasswordHash(password) {
  return bcrypt.hash(password, 10)
}

async function ensureInfluencer() {
  const password_hash = await ensurePasswordHash(PASSWORD)
  const [user] = await models.User.findOrCreate({
    where: { email: INFLUENCER_EMAIL },
    defaults: {
      name: "Influencer Test",
      email: INFLUENCER_EMAIL,
      password_hash,
      role: 2,
      user_code: INFLUENCER_CODE,
      is_active: true,
    },
  })
  if (!user.user_code || user.user_code.toUpperCase() !== INFLUENCER_CODE.toUpperCase()) {
    await user.update({ user_code: INFLUENCER_CODE })
  }
  return user
}

async function ensureWallet(influencerId) {
  if (!models.CouponWallet) return null
  const [wallet] = await models.CouponWallet.findOrCreate({
    where: { influencer_user_id: influencerId },
    defaults: { total_granted: WALLET_GRANT, total_used: 0 },
  })
  if (WALLET_GRANT > 0 && Number(wallet.total_granted || 0) < WALLET_GRANT) {
    await wallet.update({ total_granted: WALLET_GRANT })
  }
  return wallet
}

async function ensureReferredUser(influencerCode) {
  const password_hash = await ensurePasswordHash(PASSWORD)
  const [user] = await models.User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      name: "Referral User",
      email: USER_EMAIL,
      password_hash,
      role: 0,
      is_active: true,
    },
  })

  // Link referral (idempotent via service)
  await linkReferralCodeForUser({ userId: user.id, referralCode: influencerCode })
  return await models.User.findByPk(user.id)
}

async function main() {
  try {
    const influencer = await ensureInfluencer()
    const wallet = await ensureWallet(influencer.id)
    const referredUser = await ensureReferredUser(influencer.user_code || INFLUENCER_CODE)

    console.log("✅ Seed ready")
    console.log({
      influencer: {
        id: influencer.id,
        email: influencer.email,
        user_code: influencer.user_code,
      },
      wallet: wallet
        ? {
          id: wallet.id,
          total_granted: wallet.total_granted,
          total_used: wallet.total_used,
        }
        : null,
      referredUser: {
        id: referredUser.id,
        email: referredUser.email,
        referred_by_influencer_id: referredUser.referred_by_influencer_id,
        referred_by_code: referredUser.referred_by_code,
      },
      testPassword: PASSWORD,
    })
  } catch (err) {
    console.error("❌ Seed failed:", err)
  } finally {
    await sequelize.close()
  }
}

main()
