import { Sequelize } from "sequelize";
import dotenv from "dotenv";
dotenv.config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || "postgres",
    logging: false,
    dialectOptions: { timezone: process.env.DB_TIMEZONE || "Etc/UTC" },
    define: { underscored: true, freezeTableName: true, timestamps: true, paranoid: true }
  }
);
export default sequelize;
