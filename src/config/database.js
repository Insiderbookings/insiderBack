import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Cargar .env siempre desde la raíz del proyecto (aunque ejecutes node desde otro cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
};

const parseNonNegativeInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
};

const DB_POOL_MAX = parsePositiveInt(process.env.DB_POOL_MAX, 12);
const DB_POOL_MIN = Math.min(DB_POOL_MAX, parseNonNegativeInt(process.env.DB_POOL_MIN, 1));
const DB_POOL_ACQUIRE_MS = parsePositiveInt(process.env.DB_POOL_ACQUIRE_MS, 30000);
const DB_POOL_IDLE_MS = parsePositiveInt(process.env.DB_POOL_IDLE_MS, 10000);

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || "postgres",
    logging: false,
    pool: {
      max: DB_POOL_MAX,
      min: DB_POOL_MIN,
      acquire: DB_POOL_ACQUIRE_MS,
      idle: DB_POOL_IDLE_MS,
    },
    dialectOptions: { timezone: process.env.DB_TIMEZONE || "Etc/UTC" },
    define: { underscored: true, freezeTableName: true, timestamps: true, paranoid: true }
  }
);
export default sequelize;
