import { Sequelize } from "sequelize";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Cargar .env siempre desde la raíz del proyecto (aunque ejecutes node desde otro cwd)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || "postgres",
    logging: false,
    pool: {
      max: 5,
      min: 1,
      acquire: 20000,
      idle: 10000,
    },
    dialectOptions: { timezone: process.env.DB_TIMEZONE || "Etc/UTC" },
    define: { underscored: true, freezeTableName: true, timestamps: true, paranoid: true }
  }
);
export default sequelize;
