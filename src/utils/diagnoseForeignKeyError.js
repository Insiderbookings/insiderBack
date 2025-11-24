// src/utils/diagnoseForeignKeyError.js
import { QueryTypes } from "sequelize";

const referenceRegex = /REFERENCES\s+`?([A-Za-z0-9_]+)`?\s*\(`?([A-Za-z0-9_]+)`?\)/i;

/**
 * When Sequelize sync fails because of a FK constraint we can inspect the rows
 * that break the relation instead of forcing the dev to drop the table.
 */
export default async function diagnoseForeignKeyError(error, sequelize) {
  try {
    const table = error?.table;
    const field = Array.isArray(error?.fields) ? error.fields[0] : error?.fields;
    const sql = error?.parent?.sql || error?.sql;
    if (!table || !field || !sql) return false;

    const match = referenceRegex.exec(sql);
    if (!match) return false;
    const referencedTable = match[1];
    const referencedField = match[2];

    const query = `
      SELECT child.\`${field}\`   AS invalid_value,
             COUNT(*)             AS rows
      FROM \`${table}\` child
      LEFT JOIN \`${referencedTable}\` parent
             ON parent.\`${referencedField}\` = child.\`${field}\`
      WHERE child.\`${field}\` IS NOT NULL
        AND parent.\`${referencedField}\` IS NULL
      GROUP BY child.\`${field}\`
      LIMIT 25;
    `;

    const rows = await sequelize.query(query, { type: QueryTypes.SELECT });
    if (rows.length === 0) {
      console.error(
        `[FK] ${table}.${field} -> ${referencedTable}.${referencedField} failed but no orphan rows were found. Review column types/collations.`
      );
      return true;
    }

    console.error(
      `[FK] ${table}.${field} -> ${referencedTable}.${referencedField} has ${rows.length} orphan key value(s):`
    );
    rows.forEach((row) => {
      console.error(`  value=${row.invalid_value} rows=${row.rows}`);
    });
    console.error("Corrige esas filas (update/delete) y volvé a ejecutar el sync en lugar de dropear la tabla completa.");
    return true;
  } catch (diagnoseErr) {
    console.error("No se pudo diagnosticar el error de clave foránea:", diagnoseErr);
    return false;
  }
}
