import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { auth, requireAuth, userView, type AuthVars } from "./auth";
import { prismaFor } from "./db";
import type { Env } from "./env";
import { staffWallet, wallet } from "./wallet";

export { LiveReader } from "./live";

const app = new Hono<{ Bindings: Env; Variables: AuthVars }>();

app.use("*", secureHeaders());

app.get("/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ status: "ok", runtime: "workers", database: "d1" });
});

app.route("/auth", auth);

app.get("/users/me", requireAuth, async (c) => {
  const user = await prismaFor(c.env).user.findUniqueOrThrow({
    where: { id: c.var.userId },
    include: { profiles: true },
  });
  return c.json(userView(c.env, user));
});

app.route("/wallet", wallet);
app.route("/staff/wallet", staffWallet);

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.json({ statusCode: 500, message: "Internal server error" }, 500);
});

export default app;
