import { Router } from "express"
import authRoutes from "./auth.routes.js"
import userRoutes from "./user.routes.js" // ← NUEVO
import hotelRoutes from "./hotel.routes.js"
import roomRoutes from "./room.routes.js"
import discountRoutes from "./discount.routes.js"
import bookingRoutes from "./booking.routes.js"
import commissionRoutes from "./commission.routes.js"
import upsellCodeRoutes from "./upsellCode.routes.js"
import paymentRoutes from "./payment.routes.js"
import emailRoutes from "./email.routes.js"
import addonRoutes from "./addon.routes.js"
import staffAddonRoutes from "./staffAddon.routes.js"
import travelGateRoutes from "./travelgate.routes.js"
import travelgatepaymentRoutes from "./travelgate-payment.routes.js" 
import tenantsWebconstructorRoutes from './tenants.webconstructor.routes.js'
import adminRoutes from './admin.routes.js'

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
router.use("/addons", addonRoutes)
router.use("/api/staff-addon", staffAddonRoutes)
router.use("/tgx", travelGateRoutes)
router.use("/tgx-payment", travelgatepaymentRoutes);
router.use("/tenants", tenantsWebconstructorRoutes)
router.use("/admin", adminRoutes)

export default router
