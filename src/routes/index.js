import { Router } from "express"
import authRoutes from "./auth.routes.js"
import userRoutes from "./user.routes.js" // ??? NUEVO
import hotelRoutes from "./hotel.routes.js"
import roomRoutes from "./room.routes.js"
import discountRoutes from "./discount.routes.js"
import bookingRoutes from "./booking.routes.js"
import commissionRoutes from "./commission.routes.js"
import upsellCodeRoutes from "./upsellCode.routes.js"
import paymentRoutes from "./payment.routes.js"
import emailRoutes from "./email.routes.js"
import subscriberRoutes from "./subscriber.routes.js"
import addonRoutes from "./addon.routes.js"
import staffAddonRoutes from "./staffAddon.routes.js"
import webbedsRoutes from "./webbeds.routes.js"
import tenantsWebconstructorRoutes from './tenants.webconstructor.routes.js'
import vccRoutes from './vcc.routes.js'
import operatorRoutes from './operator.routes.js'
import adminRoutes from './admin.routes.js'
import homeRoutes from './home.routes.js'
import hostRoutes from "./host.routes.js"
import chatRoutes from "./chat.routes.js"
import favoriteRoutes from "./favorite.routes.js"
import reviewRoutes from "./review.routes.js"
import guestRoutes from "./guest.routes.js"
import assistantRoutes from "./assistant.routes.js"
import aiRoutes from "./ai.routes.js"
import flowsRoutes from "./flows.routes.js"
import supportRoutes from "./support.routes.js"
import analyticsRoutes from "./analytics.routes.js"
import intelligenceRoutes from "./intelligence.routes.js"

const router = Router()


router.use("/auth", authRoutes)
router.use("/users", userRoutes)
router.use("/hotels", hotelRoutes)
router.use("/hotels/:hotelId/rooms", roomRoutes)
router.use("/discounts", discountRoutes)
router.use("/bookings", bookingRoutes)
router.use("/commissions", commissionRoutes)
router.use("/upsell-code", upsellCodeRoutes)
router.use("/payments", paymentRoutes)
router.use("/email", emailRoutes)
router.use("/subscribers", subscriberRoutes)
router.use("/addons", addonRoutes)
router.use("/api/staff-addon", staffAddonRoutes)
router.use("/webbeds", webbedsRoutes)
router.use("/tenants", tenantsWebconstructorRoutes)
router.use("/tenants", vccRoutes)
router.use("/operator", operatorRoutes)
router.use("/admin", adminRoutes)
router.use("/homes", homeRoutes)
router.use("/hosts", hostRoutes)
router.use("/chats", chatRoutes)
router.use("/favorites", favoriteRoutes)
router.use("/reviews", reviewRoutes)
router.use("/guests", guestRoutes)
router.use("/assistant", assistantRoutes)
router.use("/ai", aiRoutes)
router.use("/flows", flowsRoutes)
router.use("/support", supportRoutes)
router.use("/analytics", analyticsRoutes)
router.use("/intelligence", intelligenceRoutes)

export default router
