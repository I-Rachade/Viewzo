// Converts rows exported from PostgreSQL into SQL for D1 (SQLite).
//
//   node scripts/pg-to-d1.mjs <export-dir> <out.sql>
//
// <export-dir> holds one <Model>.json per table, each a JSON array of rows as
// produced by `SELECT json_agg(t) FROM "<Model>" t` (see rehearse-migration.sh).
// Values are written the way Prisma writes them on D1, so the Worker reads
// migrated rows exactly like rows it created itself:
// - DateTime: ISO text in UTC with "+00:00" (2026-10-19T15:53:12.120+00:00),
// - Boolean: 1 / 0,
// - lists (String[], enum[]) and Json: JSON text.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema } from "./schema-lib.mjs";

const quote = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** PostgreSQL timestamp(3) without time zone holds UTC; Prisma on D1 stores this text. */
export function d1Date(value) {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d.toISOString().replace("Z", "+00:00");
}

export function sqlValue(column, value) {
  if (value === null || value === undefined) return "NULL";
  if (column.list || column.type === "Json") return quote(JSON.stringify(value));
  switch (column.type) {
    case "DateTime":
      return quote(d1Date(value));
    case "Boolean":
      return value ? "1" : "0";
    case "Int":
    case "Float":
      if (typeof value !== "number") throw new Error(`${column.name}: expected a number, got ${value}`);
      return String(value);
    default:
      return quote(value);
  }
}

/** INSERT statements for every exported table, in one SQL file. */
export function convert(exportDir, models = parseSchema().models) {
  // Foreign keys are checked at the end of the import, so tables may come in
  // any order (a user and the payments that point to each other).
  const lines = ["PRAGMA defer_foreign_keys = on;"];
  const counts = {};
  for (const [model, columns] of models) {
    const file = join(exportDir, `${model}.json`);
    if (!existsSync(file)) throw new Error(`Missing export for table ${model}`);
    const rows = JSON.parse(readFileSync(file, "utf8")) ?? [];
    counts[model] = rows.length;
    for (const row of rows) {
      const unknown = Object.keys(row).filter((k) => !columns.some((c) => c.name === k));
      if (unknown.length) throw new Error(`${model}: columns not in the schema: ${unknown.join(", ")}`);
      const names = columns.filter((c) => c.name in row);
      lines.push(
        `INSERT INTO "${model}" (${names.map((c) => `"${c.name}"`).join(",")}) VALUES (${names
          .map((c) => sqlValue(c, row[c.name]))
          .join(",")});`,
      );
    }
  }
  return { sql: lines.join("\n") + "\n", counts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [exportDir, out] = process.argv.slice(2);
  const { sql, counts } = convert(exportDir);
  writeFileSync(out, sql);
  writeFileSync(`${out}.counts.json`, JSON.stringify(counts, null, 2));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`${out}: ${total} rows from ${Object.keys(counts).length} tables`);
}
