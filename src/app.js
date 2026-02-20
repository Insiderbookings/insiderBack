// src/app.js  â”€â”€â”€ archivo COMPLETO, lÃ­nea por lÃ­nea
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

import http from "http";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import bodyParser from "body-parser";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import models, { sequelize } from "./models/index.js";
import router from "./routes/index.js";
import { handleWebhook } from "./controllers/payment.controller.js";
import { setGlobalDispatcher, Agent } from "undici";
import { ensureDefaultPlatforms } from "./services/platform.service.js";
import { ensureDefaultCurrencySettings } from "./services/currencySettings.service.js";
import { startJobScheduler } from "./services/jobScheduler.service.js";
import { startTripHubPackWorker } from "./services/tripHubPacksQueue.service.js";
import ensureHomeFavoriteIndexes from "./utils/ensureHomeFavoriteIndexes.js";
import { initSocketServer } from "./websocket/index.js";
import diagnoseForeignKeyError from "./utils/diagnoseForeignKeyError.js";
import { warmSalutationsCache } from "./providers/webbeds/salutations.js";
import globalErrorHandler from "./middleware/globalErrorHandler.js";
import statusLogger from "./middleware/statusLogger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const swaggerDocument = YAML.load(path.resolve(__dirname, "./docs/swagger.yaml"));
const swaggerDemoToken = (() => {
  const raw = process.env.SWAGGER_DEMO_TOKEN || "";
  if (!raw) return "Bearer <pega-tu-token>";
  return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
})();
const swaggerAuthUser = process.env.SWAGGER_USER || "insiderbookings";
const swaggerAuthPassword = process.env.SWAGGER_PASSWORD || "Insider1234#";
const ensureSwaggerAuth = (() => {
  if (!swaggerAuthUser || !swaggerAuthPassword) return (req, _res, next) => next();
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Swagger Docs"');
      return res.status(401).send("Authentication required");
    }
    const base64 = header.split(" ")[1] || "";
    const [user, pass] = Buffer.from(base64, "base64").toString().split(":");
    if (user === swaggerAuthUser && pass === swaggerAuthPassword) {
      return next();
    }
    res.setHeader("WWW-Authenticate", 'Basic realm="Swagger Docs"');
    return res.status(401).send("Authentication required");
  };
})();

const ensureRequiredEnv = (keys) => {
  const missing = keys.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
};

const ensureHttpsUrl = (label, value) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      throw new Error(`${label} must use https in production`);
    }
  } catch (err) {
    throw new Error(`${label} is invalid: ${value}`);
  }
};

if (process.env.NODE_ENV === "production") {
  ensureRequiredEnv([
    "JWT_SECRET",
    "CLIENT_URL",
    "CORS_ALLOWED_ORIGINS",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "WEBBEDS_TOKENIZER_URL",
    "WEBBEDS_TOKENIZER_AUTH",
  ]);
  ensureHttpsUrl("CLIENT_URL", process.env.CLIENT_URL);
  const origins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  origins.forEach((origin) => ensureHttpsUrl("CORS_ALLOWED_ORIGINS", origin));
}

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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use(statusLogger);

/* ---------- Resto de tu API ---------- */
app.get("/", (req, res) => res.json({ status: "API running" }));
// Swagger UI para explorar la documentaciÃ³n definida en src/docs/swagger.yaml
app.use("/api/docs", ensureSwaggerAuth, swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  explorer: true,
  customSiteTitle: "Insider API Docs",
  swaggerOptions: {
    persistAuthorization: true,
    authAction: {
      bearerAuth: {
        name: "bearerAuth",
        schema: {
          type: "http",
          in: "header",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        value: swaggerDemoToken,
      },
    },
  },
}));
app.get("/api/docs.json", ensureSwaggerAuth, (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerDocument);
});
// Rate limit bÃ¡sico para rutas de pago (omite webhooks)
// rate limiter import moved to header
const paymentsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path && req.path.includes("webhook"),
});
app.use("/api/payments", paymentsLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 200),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/auth", authLimiter);

// Restriccion de origen por lista blanca (si se define CORS_ALLOWED_ORIGINS)
const normalizeOrigin = (value) => String(value || "").trim().replace(/\/+$/, "")
const __allowed = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => normalizeOrigin(s))
  .filter(Boolean)
if (__allowed.length > 0) {
  app.use("/api", (req, res, next) => {
    const origin = normalizeOrigin(req.headers.origin)
    if (origin && !__allowed.includes(origin)) {
      console.warn("[cors] blocked origin", origin)
      return res.status(403).json({ error: "Origin not allowed" })
    }
    return next()
  })
}

app.use("/api/places", (req, _res, next) => {
  console.log("[api] places hit", req.method, req.originalUrl)
  return next()
})

app.use("/api", router);          // incluye /payments/* menos /webhook

app.use("/api/places", (req, res) => {
  console.warn("[api] places 404", req.method, req.originalUrl)
  return res.status(404).json({ error: "Places route not found" })
})

// Global Error Handler
app.use(globalErrorHandler);



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
    await ensureDefaultCurrencySettings();
    await warmSalutationsCache();
    initSocketServer(server);
    await startJobScheduler();
    startTripHubPackWorker();
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


// Forces restart: 2026-01-05


