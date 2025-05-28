// src/config/database.js
import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Obtener __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Carga el .env que está dos niveles arriba: insiderBack/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host          : process.env.DB_HOST,
    dialect       : process.env.DB_DIALECT,    // ahora ya no será undefined
    logging       : false,
    dialectOptions: { timezone: process.env.DB_TIMEZONE || "Etc/UTC" },
    define        : { underscored: true, freezeTableName: true, timestamps: true, paranoid: true }
  }
);

export default sequelize;
