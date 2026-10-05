import { describe, expect, it } from "vitest";
import { buttonsOf, cookieOf, joinAs, kitchen, newHouse, personIdOf, post, send, textOf } from "./helpers.ts";

describe("starting and finding a house", () => {
  it("starts a house and sends you to pick a name", async () => {
    const res = await send("/houses", { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/h\/[23456789A-HJ-NP-Z]{6}\/join$/);
  });

  it("shows the house code on its join page", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}/join`);
    expect(res.status).toBe(200);
    expect(textOf(await res.text())).toContain(code);
  });

  it("says so for a house that does not exist", async () => {
    const res = await send("/h/ZZZZZZ/join");
    expect(res.status).toBe(404);
    expect(textOf(await res.text())).toContain("no house with that code");
  });

  it("treats a malformed code in the path as no house, not an error", async () => {
    for (const bad of ["x", "ABC", "<script>", "%00", "abcdef"]) {
      const res = await send(`/h/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(404);
    }
  });

  it("finds a house from a code typed in lower case with spaces around it", async () => {
    const code = await newHouse();
    const res = await send(`/join?code=${encodeURIComponent(` ${code.toLowerCase()} `)}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("does not accept an unknown code at /join", async () => {
    const res = await send("/join?code=nope");
    expect(res.status).toBe(404);
    expect(textOf(await res.text())).toContain("no house with that code");
  });
});

describe("being someone in a house", () => {
  it("sends a visitor with no cookie to the join page", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("lets you join with a name and see the kitchen as that person", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    expect(textOf(await kitchen(code, cookie))).toContain("you are Dani");
  });

  it("remembers you on a later visit with the same cookie", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    await kitchen(code, cookie);
    expect(textOf(await kitchen(code, cookie))).toContain("you are Dani");
  });

  it("tells a second person their name is taken, whatever its case", async () => {
    const code = await newHouse();
    await joinAs(code, "Dani");
    const res = await send(`/h/${code}/join`, { form: { name: "dani" } });
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(textOf(html)).toContain("That name is taken");
    expect(buttonsOf(html)).toContain("Dani");
  });

  it("lets someone claim an existing name from a new device", async () => {
    const code = await newHouse();
    await joinAs(code, "Dani");
    const claim = await send(`/h/${code}/claim`, { form: { person: await personIdOf(code, "Dani") } });
    expect(claim.status).toBe(303);
    expect(textOf(await kitchen(code, cookieOf(claim)))).toContain("you are Dani");
  });

  it("rejects a claim for a person who is not in this house", async () => {
    const a = await newHouse();
    const b = await newHouse();
    await joinAs(a, "Dani");
    const id = await personIdOf(a, "Dani");
    for (const person of [id, "9999999", "abc", ""]) {
      const res = await send(`/h/${b}/claim`, { form: { person } });
      expect(res.status, JSON.stringify(person)).toBe(400);
    }
  });

  it("rejects bad names with a clear message", async () => {
    const code = await newHouse();
    for (const name of ["", "   ", "x".repeat(25), "bad\u0007name"]) {
      const res = await send(`/h/${code}/join`, { form: { name } });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(textOf(await res.text())).toContain("Pick a name");
    }
  });

  it("answers a join with no name field at all with a 400", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}/join`, { form: {} });
    expect(res.status).toBe(400);
  });

  it("keeps a cookie to its own house", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookie = await joinAs(a, "Dani");
    const forged = cookie.replace(`person_${a}`, `person_${b}`);
    const res = await send(`/h/${b}`, { cookie: forged });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${b}/join`);
  });

  it("treats a garbage cookie as no cookie", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}`, { cookie: `person_${code}=nonsense` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("shows a name containing markup as text, on the join and kitchen pages", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, `<b>x</b> Da"ni'`);
    const kitchenHtml = await kitchen(code, cookie);
    expect(kitchenHtml).not.toContain("<b>x</b>");
    expect(textOf(kitchenHtml)).toContain(`<b>x</b> Da"ni'`);
    const joinHtml = await (await send(`/h/${code}/join`)).text();
    expect(joinHtml).not.toContain("<b>x</b>");
    expect(buttonsOf(joinHtml)).toContain(`<b>x</b> Da"ni'`);
  });

  it("does not let a person from one house act in another", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookie = await joinAs(a, "Dani");
    const res = await post(`/h/${b}/cook`, cookie, { action: "start" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${b}/join`);
  });
});
