// src/app.js  ─── archivo COMPLETO, línea por línea
import dotenv          from "dotenv";
import dotenvExpand     from "dotenv-expand";
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

import http            from "http";
import express         from "express";
import morgan          from "morgan";
import cors            from "cors";
import bodyParser      from "body-parser";
import rateLimit       from "express-rate-limit";
import models, { sequelize } from "./models/index.js";
import router          from "./routes/index.js";
import { handleWebhook } from "./controllers/payment.controller.js";
import { setGlobalDispatcher, Agent } from "undici";
import { ensureDefaultPlatforms } from "./services/platform.service.js";
import ensureHomeFavoriteIndexes from "./utils/ensureHomeFavoriteIndexes.js";
import { initSocketServer } from "./websocket/index.js";
import diagnoseForeignKeyError from "./utils/diagnoseForeignKeyError.js";

const app = express();
const server = http.createServer(app);
app.disable("etag");

/* ---------- Stripe webhook RAW antes de json() ---------- */
app.post(
  "/api/payments/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook
);
app.use(
  "/api/payments/stripe/webhook",
  bodyParser.raw({ type: "application/json" })
);

/* ---------- Middlewares globales ---------- */
app.use(cors());
app.use(express.json());          // se aplica a todo lo DEMÁS
app.use(morgan("dev"));

/* ---------- Resto de tu API ---------- */
app.get("/", (req, res) => res.json({ status: "API running" }));
// Rate limit básico para rutas de pago (omite webhooks)
// rate limiter import moved to header
const paymentsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path && req.path.includes("webhook"),
});
app.use("/api/payments", paymentsLimiter);
app.use("/api/tgx-payment", paymentsLimiter);

// Restricción de origen por lista blanca (si se define CORS_ALLOWED_ORIGINS)
const __allowed = (process.env.CORS_ALLOWED_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean)
if (__allowed.length > 0) {
  app.use("/api", (req, res, next) => {
    const origin = req.headers.origin
    if (origin && !__allowed.includes(origin)) {
      return res.status(403).json({ error: "Origin not allowed" })
    }
    return next()
  })
}

app.use("/api", router);          // incluye /payments/* menos /webhook



/* ---------- Arranque ---------- */
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await sequelize.authenticate();
    const alterEnv = String(process.env.DB_ALTER_SYNC || "false").toLowerCase();
    const allowAlter = ["1", "true", "yes"].includes(alterEnv) && process.env.NODE_ENV !== "production";
    if (!allowAlter && ["1", "true", "yes"].includes(alterEnv)) {
      console.warn('[sequelize] alter sync was requested but ignored in this environment');
    }
    await sequelize.sync({ alter: allowAlter });
    await ensureHomeFavoriteIndexes();
    await ensureDefaultPlatforms();
    initSocketServer(server);
    server.listen(PORT, () =>
      console.log(`Server listening on port ${PORT}`)
    );
  } catch (err) {
    if (err.name === "SequelizeForeignKeyConstraintError") {
      await diagnoseForeignKeyError(err, sequelize);
    }
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();

/* const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await sequelize.authenticate();
    const alter = String(process.env.DB_ALTER_SYNC || "false").toLowerCase()
    await sequelize.sync({ alter: ["1","true","yes"].includes(alter) });
    app.listen(PORT, () =>
      console.log(`Server listening on port ${PORT}`)
    );
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
 */
