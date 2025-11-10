import Stripe from "stripe";
import models from "../models/index.js";

const STRIPE_SECRET_KEY_TEST = process.env.STRIPE_SECRET_KEY_TEST;
if (!STRIPE_SECRET_KEY_TEST) {
  throw new Error("⚠️ Falta STRIPE_SECRET_KEY_TEST en .env para la ruta de pruebas.");
}

const stripeTestClient = new Stripe(STRIPE_SECRET_KEY_TEST, { apiVersion: "2022-11-15" });

const trim500 = (value) => (value == null ? "" : String(value).slice(0, 500));

export const createHomePaymentIntentAppTest = async (req, res) => {
  try {
    const { bookingId, captureMode } = req.body || {};
    const userId = Number(req.user?.id ?? 0);

    if (!bookingId) return res.status(400).json({ error: "bookingId is required" });
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const booking = await models.Booking.findOne({
      where: { id: bookingId },
      include: [{ model: models.StayHome, as: "homeStay" }],
    });

    if (!booking || String(booking.inventory_type).toUpperCase() !== "HOME") {
      return res.status(404).json({ error: "Home booking not found" });
    }

    if (booking.user_id && booking.user_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (String(booking.status).toUpperCase() === "CANCELLED") {
      return res.status(400).json({ error: "Booking is cancelled" });
    }

    if (String(booking.payment_status).toUpperCase() === "PAID") {
      return res.status(400).json({ error: "Booking is already paid" });
    }

    const amountNumber = Number(booking.gross_price ?? 0);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ error: "Invalid booking amount" });
    }

    const currencyCode = String(booking.currency || "USD").trim().toUpperCase();
    const stripeCurrency = currencyCode.toLowerCase();
    const amountCents = Math.round(amountNumber * 100);

    const pricingSnapshot =
      booking.pricing_snapshot && typeof booking.pricing_snapshot === "object"
        ? booking.pricing_snapshot
        : {};
    const securityDepositRaw =
      booking.homeStay?.security_deposit ?? pricingSnapshot.securityDeposit ?? 0;
    const securityDeposit =
      Number.parseFloat(Number(securityDepositRaw ?? 0).toFixed(2)) || 0;
    const depositCents = securityDeposit > 0 ? Math.round(securityDeposit * 100) : 0;

    const captureMethod =
      captureMode === "manual"
        ? "manual"
        : depositCents > 0
        ? "manual"
        : "automatic";

    const metadata = {
      type: "home_booking",
      environment: "test",
      bookingId: String(booking.id),
      booking_id: String(booking.id),
      bookingRef: booking.booking_ref || "",
      userId: booking.user_id ? String(booking.user_id) : "",
      homeId: booking.homeStay?.home_id != null ? String(booking.homeStay.home_id) : "",
      checkIn: booking.check_in || "",
      checkOut: booking.check_out || "",
      guestName: trim500(booking.guest_name || ""),
      guestEmail: trim500(booking.guest_email || ""),
      securityDeposit: depositCents ? securityDeposit.toFixed(2) : "0.00",
      captureMethod,
    };
    if (!metadata.userId) delete metadata.userId;
    if (!metadata.homeId) delete metadata.homeId;

    let paymentIntent = null;
    let reusedIntent = false;

    if (booking.payment_intent_id) {
      try {
        paymentIntent = await stripeTestClient.paymentIntents.retrieve(booking.payment_intent_id);
      } catch (retrieveErr) {
        console.warn(
          "createHomePaymentIntentAppTest: unable to retrieve existing intent:",
          retrieveErr?.message || retrieveErr
        );
      }
    }

    if (paymentIntent) {
      if (paymentIntent.status === "succeeded") {
        await booking.update({
          payment_provider: "STRIPE",
          payment_status: "PAID",
          payment_intent_id: paymentIntent.id,
        });
        return res.json({
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          amount: amountNumber,
          amountCents,
          currency: currencyCode,
          depositAmount: securityDeposit,
          captureMethod: paymentIntent.capture_method,
          status: paymentIntent.status,
          paymentStatus: "PAID",
          reused: true,
        });
      }

      if (paymentIntent.status === "canceled") {
        paymentIntent = null;
      } else {
        const amountMismatch = paymentIntent.amount !== amountCents;
        const currencyMismatch = paymentIntent.currency !== stripeCurrency;
        const captureMismatch = paymentIntent.capture_method !== captureMethod;

        if (currencyMismatch || captureMismatch) {
          try {
            await stripeTestClient.paymentIntents.cancel(paymentIntent.id);
          } catch (cancelErr) {
            console.warn(
              "createHomePaymentIntentAppTest: unable to cancel mismatched intent:",
              cancelErr?.message || cancelErr
            );
          }
          paymentIntent = null;
        } else if (amountMismatch) {
          try {
            paymentIntent = await stripeTestClient.paymentIntents.update(paymentIntent.id, {
              amount: amountCents,
              metadata,
            });
            reusedIntent = true;
          } catch (updateErr) {
            console.warn(
              "createHomePaymentIntentAppTest: unable to update intent amount:",
              updateErr?.message || updateErr
            );
            try {
              await stripeTestClient.paymentIntents.cancel(paymentIntent.id);
            } catch (cancelErr) {
              console.warn(
                "createHomePaymentIntentAppTest: cancel after failed update:",
                cancelErr?.message || cancelErr
              );
            }
            paymentIntent = null;
          }
        } else {
          try {
            paymentIntent = await stripeTestClient.paymentIntents.update(paymentIntent.id, {
              metadata,
            });
            reusedIntent = true;
          } catch (metaErr) {
            console.warn(
              "createHomePaymentIntentAppTest: unable to refresh intent metadata:",
              metaErr?.message || metaErr
            );
          }
        }
      }
    }

    if (!paymentIntent) {
      paymentIntent = await stripeTestClient.paymentIntents.create({
        amount: amountCents,
        currency: stripeCurrency,
        capture_method: captureMethod,
        automatic_payment_methods: { enabled: true },
        metadata,
        description: `Home booking (test) ${booking.booking_ref || booking.id}`,
        receipt_email: booking.guest_email || undefined,
      });
    }

    const nextStripeStatus = paymentIntent.status;
    let nextPaymentStatus = booking.payment_status;
    if (nextStripeStatus === "succeeded") {
      nextPaymentStatus = "PAID";
    } else if (nextStripeStatus === "requires_payment_method") {
      nextPaymentStatus = "UNPAID";
    } else if (booking.payment_status !== "PAID") {
      nextPaymentStatus = "PENDING";
    }

    const nextMeta =
      booking.meta && typeof booking.meta === "object" ? { ...booking.meta } : {};
    nextMeta.payment = {
      ...(typeof nextMeta.payment === "object" ? nextMeta.payment : {}),
      provider: "stripe",
      strategy: captureMethod,
      environment: "test",
      amount: Number(amountNumber.toFixed(2)),
      currency: currencyCode,
      securityDeposit,
      intentId: paymentIntent.id,
      intentStatus: paymentIntent.status,
      lastUpdatedAt: new Date().toISOString(),
    };

    const updates = {
      payment_provider: "STRIPE",
      payment_intent_id: paymentIntent.id,
      meta: nextMeta,
    };
    if (booking.payment_status !== nextPaymentStatus) {
      updates.payment_status = nextPaymentStatus;
    }
    await booking.update(updates);

    return res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: amountNumber,
      amountCents,
      currency: currencyCode,
      depositAmount: securityDeposit,
      captureMethod: paymentIntent.capture_method,
      status: paymentIntent.status,
      paymentStatus: booking.payment_status,
      reused: reusedIntent,
    });
  } catch (error) {
    console.error("createHomePaymentIntentAppTest error:", error);
    return res.status(500).json({ error: "Unable to create home payment intent (test)" });
  }
};
