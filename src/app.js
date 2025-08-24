// src/app.js  ─── archivo COMPLETO, línea por línea
import dotenv          from "dotenv";
import dotenvExpand     from "dotenv-expand";
const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

import express         from "express";
import morgan          from "morgan";
import cors            from "cors";
import bodyParser      from "body-parser";
import models, { sequelize } from "./models/index.js";
import router          from "./routes/index.js";
import { handleWebhook } from "./controllers/payment.controller.js";
import { setGlobalDispatcher, Agent } from "undici";

const app = express();

/* ---------- Stripe webhook RAW antes de json() ---------- */
app.post(
  "/api/payments/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook
);

/* ---------- Middlewares globales ---------- */
app.use(cors());
app.use(express.json());          // se aplica a todo lo DEMÁS
app.use(morgan("dev"));

/* ---------- Resto de tu API ---------- */
app.get("/", (req, res) => res.json({ status: "API running" }));
app.use("/api", router);          // incluye /payments/* menos /webhook



/* ---------- Arranque ---------- */
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: false });
    app.listen(PORT, () =>
      console.log(`Server listening on port ${PORT}`)
    );
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
})();
