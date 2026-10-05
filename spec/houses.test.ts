import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buttonsOf, cookieOf, cookingListOf, joinAs, kitchen, newHouse, personIdOf, post, send, textOf } from "./helpers.ts";

const link = (html: string, href: string): Element | null =>
  new JSDOM(html).window.document.querySelector(`a[href="${href}"]`);

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

  it("finds you, and the house as you left it, on a later visit", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    expect((await post(`/h/${code}/cook`, cookie, { action: "start" })).status).toBe(303);
    const later = await kitchen(code, cookie);
    expect(textOf(later)).toContain("you are Dani");
    expect(cookingListOf(later)).toEqual(["Dani"]);
  });

  it("recognises a returning person on the join page, but not a stranger", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    const known = await (await send(`/h/${code}/join`, { cookie })).text();
    expect(textOf(known)).toContain("already in this house as Dani");
    expect(link(known, `/h/${code}`)).not.toBeNull();
    const stranger = await (await send(`/h/${code}/join`)).text();
    expect(textOf(stranger)).not.toContain("already in this house as");
    const garbage = await (await send(`/h/${code}/join`, { cookie: `person_${code}=nonsense` })).text();
    expect(textOf(garbage)).not.toContain("already in this house as");
  });

  it("lists your houses on the home page, and none for a stranger or a garbage cookie", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookieA = await joinAs(a, "Dani");
    const cookieB = await joinAs(b, "Rafi");

    const one = await (await send("/", { cookie: cookieA })).text();
    expect(link(one, `/h/${a}`)).not.toBeNull();
    expect(link(one, `/h/${b}`)).toBeNull();

    const both = await (await send("/", { cookie: `${cookieA}; ${cookieB}` })).text();
    expect(link(both, `/h/${a}`)).not.toBeNull();
    expect(link(both, `/h/${b}`)).not.toBeNull();

    for (const cookie of [undefined, `person_${a}=nonsense`]) {
      const html = await (await send("/", { cookie })).text();
      expect(textOf(html), String(cookie)).not.toContain("Your houses");
    }
  });

  it("lists your houses on the page for an unknown code too", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    const res = await send("/join?code=nope", { cookie });
    expect(res.status).toBe(404);
    expect(link(await res.text(), `/h/${code}`)).not.toBeNull();
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
    expect(forged).not.toBe(cookie);
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
