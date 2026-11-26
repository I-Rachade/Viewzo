// Reads backend/prisma/schema.prisma (PostgreSQL) without any dependency, so
// the same description drives the SQLite schema for D1 (full-schema.mjs) and
// the data export from PostgreSQL to D1 (pg-to-d1.mjs).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BACKEND_SCHEMA = resolve(here, "../../../backend/prisma/schema.prisma");

const SCALARS = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "BigInt", "Decimal", "Bytes"]);

/** Models and enums of a Prisma schema, with the type of every column. */
export function parseSchema(text = readFileSync(BACKEND_SCHEMA, "utf8")) {
  const blocks = [...text.matchAll(/^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  const enums = new Set(blocks.filter((b) => b[1] === "enum").map((b) => b[2]));
  const models = new Map();
  for (const [, kind, name, body] of blocks) {
    if (kind !== "model") continue;
    const columns = [];
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?/);
      if (!m || line.trim().startsWith("//") || line.trim().startsWith("@@")) continue;
      const [, field, type, list, optional] = m;
      // Relation fields (another model) are not columns.
      if (!SCALARS.has(type) && !enums.has(type)) continue;
      columns.push({ name: field, type, list: Boolean(list), optional: Boolean(optional), isEnum: enums.has(type) });
    }
    models.set(name, columns);
  }
  return { models, enums };
}
