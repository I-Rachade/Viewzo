// Checks the local D1 filled by rehearse-migration.sh: same number of rows as
// in PostgreSQL, values in the form Prisma expects on D1, and the wallet
// guard working on migrated money.
//
//   node scripts/verify-import.mjs build/rehearsal
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const expected = JSON.parse(readFileSync(join(dir, "import.sql.counts.json"), "utf8"));

function d1(sql) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "viewzo-probe", "--local", "--persist-to", join(dir, "state"), "--json", "--command", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out)[0].results;
}

// 1. Every table, same row count.
const counts = d1(
  Object.keys(expected)
    .map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM "${t}"`)
    .join(" UNION ALL "),
);
for (const { t, n } of counts) assert.equal(n, expected[t], `rows in ${t}`);
const total = Object.values(expected).reduce((a, b) => a + b, 0);
assert.ok(total >= 9, "the sample rows were exported");

// 2. Values in the form Prisma writes on D1.
const [creator] = d1(`SELECT * FROM "User" WHERE "id" = 'u-creator'`);
assert.equal(creator.firstName, "Éloïse O'Neil");
assert.equal(creator.phoneVerifiedAt, "2026-10-19T15:53:12.120+00:00");
assert.equal(creator.createdAt, "2026-10-19T15:53:12.000+00:00");
assert.equal(creator.staffCountries, "[]");
const [staff] = d1(`SELECT "staffCountries", "staffRole" FROM "User" WHERE "id" = 'u-staff'`);
assert.deepEqual(JSON.parse(staff.staffCountries), ["TG", "BJ"]);
assert.equal(staff.staffRole, "FINANCE");

const [skills] = d1(`SELECT * FROM "CreatorSkills" WHERE "userId" = 'u-creator'`);
assert.deepEqual(JSON.parse(skills.taskTypes), ["LIVE_SELLING", "CREATE_ORIGINAL_VIDEO"]);
assert.deepEqual(JSON.parse(skills.cities), ["Lomé", "Kpalimé"]);
assert.equal(skills.showsFace, 1);

const [audit] = d1(`SELECT "after" FROM "AuditLog" WHERE "id" = 'a-1'`);
assert.deepEqual(JSON.parse(audit.after), { status: "PROCESSING", note: 'vérifié "ok"', amounts: [1, 2.5] });

// Lists stay searchable: the D1 form of Prisma's `countries: { has: 'TG' }`.
const [{ n: staffForBJ }] = d1(
  `SELECT COUNT(*) AS n FROM "User" WHERE EXISTS (SELECT 1 FROM json_each("staffCountries") WHERE value = 'BJ')`,
);
assert.equal(staffForBJ, 1);

// 3. The payment and its held transaction still point to each other.
const [link] = d1(
  `SELECT p."status", t."amount" FROM "Payment" p JOIN "Transaction" t ON t."paymentId" = p."id" WHERE p."id" = 'pay-1'`,
);
assert.deepEqual(link, { status: "REQUESTED", amount: -2500 });

// 4. The wallet guard sees migrated money: 10 000 earned, 700 frozen,
// 2 500 already asked for, so 7 500 can still be withdrawn and not more.
const withdraw = (id, amount) =>
  d1(
    `INSERT INTO "Transaction" ("id","userId","type","amount","currency","status","availableAt","frozen","createdAt","updatedAt")
     VALUES ('${id}','u-creator','WITHDRAWAL',${-amount},'XOF','PENDING',
       strftime('%Y-%m-%dT%H:%M:%f+00:00','now'),0,strftime('%Y-%m-%dT%H:%M:%f+00:00','now'),strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))`,
  );
assert.throws(() => withdraw("t-too-much", 7501), (err) =>
  /INSUFFICIENT_BALANCE/.test(`${err.message}${err.stdout ?? ""}${err.stderr ?? ""}`),
);
withdraw("t-rest", 7500);

console.log(`Import verified: ${total} rows in ${counts.length} tables, values and wallet guard OK`);
