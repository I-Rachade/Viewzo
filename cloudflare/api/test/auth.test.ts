import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { login, makeUser } from "./helpers";

describe("login on Workers + D1", () => {
  it("signs in with the password and opens a session", async () => {
    const { email, user } = await makeUser();
    const { res, body } = await login(email);
    expect(res.status).toBe(200);
    expect(body.user).toMatchObject({ id: user.id, country: "TG", hasPassword: true, isFounder: true });
    expect(body.refreshToken.split(".")[0]).toHaveLength(32);

    const me = await SELF.fetch("https://api.test/users/me", {
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.status).toBe(200);
    expect(((await me.json()) as any).profiles).toEqual([{ type: "CREATOR", level: 1 }]);
  });

  it("accepts the phone number in local format", async () => {
    const { user } = await makeUser();
    const { res } = await login(user.phone!.replace("+228", ""));
    expect(res.status).toBe(200);
  });

  it("refuses a wrong password and locks after five", async () => {
    const { email } = await makeUser();
    for (let i = 0; i < 5; i++) {
      expect((await login(email, "wrong-password")).res.status).toBe(401);
    }
    const locked = await login(email);
    expect(locked.res.status).toBe(429);
  });

  it("counts parallel wrong passwords, none is lost", async () => {
    const { email } = await makeUser();
    await Promise.all(Array.from({ length: 5 }, () => login(email, "wrong-password")));
    expect((await login(email)).res.status).toBe(429);
  });

  it("answers an unknown account like a wrong password", async () => {
    const { res, body } = await login("nobody@viewzo.test");
    expect(res.status).toBe(401);
    expect(body.message).toBe("Identifiants incorrects");
  });

  it("rejects requests without a valid token", async () => {
    const res = await SELF.fetch("https://api.test/users/me", { headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });
});
