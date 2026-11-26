import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MAX_PROOF_BYTES } from "../src/files";
import { makeUser, tokenFor } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);

async function upload(token: string, bytes: Uint8Array, name = "capture.png") {
  const form = new FormData();
  form.append("file", new File([bytes], name, { type: "image/png" }));
  return SELF.fetch("https://api.test/files/proofs", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

describe("proof screenshots in R2", () => {
  it("stores the image and serves it through a signed link only", async () => {
    const { email } = await makeUser();
    const token = await tokenFor(email);
    const res = await upload(token, PNG);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ mimeType: "image/png", sizeBytes: PNG.length });
    expect(body.key).toMatch(/^proofs\/[0-9a-f-]{36}\.png$/);

    const object = await env.FILES.get(body.key);
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(PNG);
    expect(object!.customMetadata?.sha256).toBe(body.sha256);

    const ok = await SELF.fetch(body.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);

    const unsigned = await SELF.fetch(body.url.replace(/\?.*$/, ""));
    expect(unsigned.status).toBe(403);
    const forged = await SELF.fetch(body.url.replace(/sig=[^&]+/, "sig=AAAA"));
    expect(forged.status).toBe(403);
    const otherFile = await SELF.fetch(body.url.replace(body.key.slice(7), "00000000-0000-0000-0000-000000000000.png"));
    expect(otherFile.status).toBe(403);
  });

  it("checks the type from the bytes, not the file name", async () => {
    const { email } = await makeUser();
    const res = await upload(await tokenFor(email), new TextEncoder().encode("<html>not an image</html>"), "x.png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toBe("Envoie une image JPEG, PNG ou WebP");
  });

  it("refuses files over 8 MB and anonymous uploads", async () => {
    const { email } = await makeUser();
    const big = new Uint8Array(MAX_PROOF_BYTES + 1);
    big.set(PNG);
    expect((await upload(await tokenFor(email), big)).status).toBe(400);
    expect((await upload("not-a-token", PNG)).status).toBe(401);
  });
});
