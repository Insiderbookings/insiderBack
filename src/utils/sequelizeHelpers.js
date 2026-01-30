import { Op } from "sequelize";
import { sequelize } from "../models/index.js";

const getDialect = () => {
  if (typeof sequelize?.getDialect === "function") {
    try {
      return sequelize.getDialect();
    } catch {
      // fall through
    }
  }
  return process.env.DB_DIALECT || "";
};

const isMySqlFamily = () => {
  const dialect = String(getDialect() || "").toLowerCase();
  return dialect === "mysql" || dialect === "mariadb";
};

export const getCaseInsensitiveLikeOp = () => (isMySqlFamily() ? Op.like : Op.iLike);

export const getDialectName = () => String(getDialect() || "").toLowerCase();

export const isMysqlLikeDialect = () => isMySqlFamily();
