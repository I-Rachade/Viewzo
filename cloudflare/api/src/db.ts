import { PrismaD1 } from "@prisma/adapter-d1";
import { PrismaClient } from "./generated/prisma/client";
import type { Env } from "./env";

/** Prisma on D1, for one request. Creating it is cheap: no connection pool. */
export function prismaFor(env: Pick<Env, "DB">) {
  return new PrismaClient({ adapter: new PrismaD1(env.DB) });
}

export type Db = ReturnType<typeof prismaFor>;
