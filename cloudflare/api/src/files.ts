import { Hono } from "hono";
import { Buffer } from "node:buffer";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireAuth, type AuthVars } from "./auth";
import type { Env } from "./env";
import { fail } from "./errors";

// Proof screenshots in R2 instead of the server disk (backend/src/posts/
// proof-storage.ts, Docker volume /data/uploads). Same rules: 8 MB at most,
// type read from the first bytes, files only reachable through links signed
// with JWT_SECRET that work 6 hours.
export const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const LINK_TTL_MS = 6 * 3600 * 1000;

export function sniffImage(b: Uint8Array) {
  if (b.length < 12) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) {
    return { mime: "image/png", ext: "png" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

const signature = (env: Env, key: string, exp: number) =>
  createHmac("sha256", env.JWT_SECRET).update(`${key}:${exp}`).digest("base64url");

export function signedUrl(env: Env, base: string, key: string, now = Date.now()) {
  const exp = now + LINK_TTL_MS;
  return `${base}/files/${key}?exp=${exp}&sig=${signature(env, key, exp)}`;
}

function validSignature(env: Env, key: string, exp: string | undefined, sig: string | undefined) {
  const expMs = Number(exp);
  if (!sig || !Number.isFinite(expMs) || expMs < Date.now()) return false;
  const expected = Buffer.from(signature(env, key, expMs));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const files = new Hono<{ Bindings: Env; Variables: AuthVars }>();

files.post("/proofs", requireAuth, async (c) => {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > MAX_PROOF_BYTES + 64 * 1024) fail(400, "Capture trop lourde (8 Mo maximum)");
  const form = await c.req.formData().catch(() => null);
  // workers-types declare get() as string only; uploaded files are File objects.
  const file = form?.get("file") as unknown as File | string | null | undefined;
  if (!file || typeof file === "string" || file.size === 0) fail(400, "Ajoute une capture d’écran");
  if (file.size > MAX_PROOF_BYTES) fail(400, "Capture trop lourde (8 Mo maximum)");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) fail(400, "Envoie une image JPEG, PNG ou WebP");
  const key = `proofs/${randomUUID()}.${type.ext}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: type.mime },
    customMetadata: { userId: c.var.userId, sha256 },
  });
  return c.json(
    { key, mimeType: type.mime, sizeBytes: bytes.length, sha256, url: signedUrl(c.env, new URL(c.req.url).origin, key) },
    201,
  );
});

files.get("/proofs/:name", async (c) => {
  const key = `proofs/${c.req.param("name")}`;
  if (!validSignature(c.env, key, c.req.query("exp"), c.req.query("sig"))) fail(403, "Lien expiré ou invalide");
  const object = await c.env.FILES.get(key);
  if (!object) fail(404, "Fichier introuvable");
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
});
