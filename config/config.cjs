const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

const base = {
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || null,
  database: process.env.DB_NAME || "insider",
  host: process.env.DB_HOST || "localhost",
  dialect: process.env.DB_DIALECT || "postgres",
  timezone: process.env.DB_TIMEZONE || "Etc/UTC",
  logging: false,
  define: { underscored: true, freezeTableName: true, timestamps: true, paranoid: true },
};

module.exports = {
  development: base,
  test: base,
  production: base,
};
