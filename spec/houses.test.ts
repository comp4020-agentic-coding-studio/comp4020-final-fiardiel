import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  addBill,
  cookieOf,
  historyOf,
  housePage,
  joinAs,
  newHouse,
  personIdOf,
  post,
  send,
  setUpHouse,
  signInAs,
  textOf,
  tilesOf,
} from "./helpers.ts";

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
    for (const bad of ["x", "ABC", "<script>", "%00"]) {
      const res = await send(`/h/${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(404);
    }
  });

  it("sends a lower-case code in a path to the upper-case one, for reading only", async () => {
    const code = await newHouse();
    const lower = code.toLowerCase();

    const join = await send(`/h/${lower}/join`);
    expect(join.status).toBe(303);
    expect(join.headers.get("location")).toBe(`/h/${code}/join`);
    expect((await send(join.headers.get("location") ?? "")).status).toBe(200);

    const home = await send(`/h/${lower}`);
    expect(home.status).toBe(303);
    expect(home.headers.get("location")).toBe(`/h/${code}`);
  });

  it("redirects a lower-case code of a house that does not exist, then says there is none", async () => {
    const res = await send("/h/zzzzzz/join");
    expect(res.status).toBe(303);
    const target = res.headers.get("location") ?? "";
    expect(target).toBe("/h/ZZZZZZ/join");
    expect((await send(target)).status).toBe(404);
  });

  it("does not act on a lower-case code in a POST", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code.toLowerCase()}/join`, { form: { name: "Dani" } });
    expect(res.status).toBe(404);
    expect(await personIdOf(code, "Dani").catch(() => null)).toBeNull();
  });

  it("does not redirect a path that is no code even in upper case", async () => {
    const res = await send("/h/%3Cscript%3E");
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
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

  it("lets you join with a name and see the house as that person", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    expect(textOf(await housePage(code, cookie))).toContain("you are Dani");
  });

  it("finds you, and the house as you left it, on a later visit", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    const id = await personIdOf(code, "Dani");
    expect((await addBill(code, cookie, "Rice", { [id]: "5" })).status).toBe(303);
    const later = await housePage(code, cookie);
    expect(textOf(later)).toContain("you are Dani");
    expect(historyOf(later)).toEqual([{ pill: "Bill", what: "Rice", total: "$5.00", by: "You paid", chips: ["You $5.00"] }]);
  });

  it("sends this device's own tile straight to the house, but not a stranger's", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    const known = await (await send(`/h/${code}/join`, { cookie })).text();
    expect(link(known, `/h/${code}`)?.textContent).toContain("Dani");
    expect(textOf(known)).toContain("this device");
    for (const other of [undefined, `person_${code}=nonsense`]) {
      const html = await (await send(`/h/${code}/join`, { cookie: other })).text();
      expect(link(html, `/h/${code}`), String(other)).toBeNull();
      expect(textOf(html)).not.toContain("this device");
    }
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
    for (const res of [
      await send(`/h/${code}/new`, { form: { name: "dani" } }),
      await send(`/h/${code}/join`, { form: { name: "dani", pin: "1234" } }),
    ]) {
      expect(res.status).toBe(409);
      expect(textOf(await res.text())).toContain("That name is taken");
    }
  });

  it("asks for the name, then a PIN, carrying the name across", async () => {
    const code = await newHouse();
    const res = await send(`/h/${code}/new`, { form: { name: "  Sam  " } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(textOf(html)).toContain("Choose a PIN, Sam");
    const name = new JSDOM(html).window.document.querySelector<HTMLInputElement>('input[name="name"]');
    expect(name?.value).toBe("Sam");
    expect(await personIdOf(code, "Sam").catch(() => null)).toBeNull();
  });

  it("rejects bad names with a clear message", async () => {
    const code = await newHouse();
    for (const name of ["", "   ", "x".repeat(25), "bad\u0007name"]) {
      const res = await send(`/h/${code}/new`, { form: { name } });
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

  it("shows a name containing markup as text, on the join and house pages", async () => {
    const code = await newHouse();
    const cookie = await joinAs(code, `<b>x</b> Da"ni'`);
    const houseHtml = await housePage(code, cookie);
    expect(houseHtml).not.toContain("<b>x</b>");
    expect(textOf(houseHtml)).toContain(`<b>x</b> Da"ni'`);
    const joinHtml = await (await send(`/h/${code}/join`)).text();
    expect(joinHtml).not.toContain("<b>x</b>");
    expect(tilesOf(joinHtml)).toContain(`<b>x</b> Da"ni'`);
  });

  it("does not let a person from one house act in another", async () => {
    const a = await newHouse();
    const b = await newHouse();
    const cookie = await joinAs(a, "Dani");
    const res = await post(`/h/${b}/bill`, cookie, { note: "x", intent: "add" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${b}/join`);
  });
});

describe("PINs", () => {
  it("asks for a 4-digit PIN when joining", async () => {
    const code = await newHouse();
    for (const pin of ["", "12", "12345", "abcd", " 1234", "١٢٣٤"]) {
      const res = await send(`/h/${code}/join`, { form: { name: "Dani", pin } });
      expect(res.status, pin).toBe(400);
      expect(textOf(await res.text())).toContain("Pick a 4-digit PIN");
    }
    expect(await personIdOf(code, "Dani").catch(() => null)).toBeNull();
  });

  it("opens a name on a new device only with its PIN", async () => {
    const code = await newHouse();
    await joinAs(code, "Dani", "0427");
    const id = await personIdOf(code, "Dani");
    expect(textOf(await (await send(`/h/${code}/as/${id}`)).text())).toContain("Dani's PIN");
    const wrong = await signInAs(code, id, "1111");
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toEqual([]);
    expect(textOf(await wrong.text())).toContain("That PIN isn't right");
    const right = await signInAs(code, id, "0427");
    expect(right.status).toBe(303);
    expect(textOf(await housePage(code, cookieOf(right)))).toContain("you are Dani");
  });

  it("won't show or open a person from another house, or no one", async () => {
    const a = await newHouse();
    const b = await newHouse();
    await joinAs(a, "Dani");
    const id = await personIdOf(a, "Dani");
    for (const [code, who] of [[b, id], [a, "9999999"]]) {
      expect((await send(`/h/${code}/as/${who}`)).status).toBe(404);
      expect((await signInAs(code, who, "1234")).status).toBe(404);
      expect((await send(`/h/${code}/reset/${who}`)).status).toBe(404);
      expect((await send(`/h/${code}/reset/${who}`, { form: { code, pin: "5678" } })).status).toBe(404);
    }
    expect((await signInAs(a, id, "1234")).status).toBe(303);
  });

  it("only takes a person id on the PIN and reset pages", async () => {
    const { code, ids } = await setUpHouse("Dani");
    expect((await send(`/h/${code}/as`)).status).toBe(404);
    expect((await send(`/h/${code}/history/${ids.Dani}`)).status).toBe(404);
    // The old open claim is gone: posting to it signs nobody in.
    const claim = await send(`/h/${code}/claim`, { form: { person: ids.Dani } });
    expect(claim.headers.getSetCookie()).toEqual([]);
    expect(claim.headers.get("location")).toBe(`/h/${code}/join`);
  });

  it("resets a PIN with the house code typed loosely, signs the old device out, and tells the house", async () => {
    const { code, cookies, ids } = await setUpHouse("Ana", "Dani");
    const loose = `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`;
    const step = await send(`/h/${code}/reset/${ids.Dani}`, { form: { code: loose } });
    expect(step.status).toBe(200);
    expect(textOf(await step.text())).toContain("Choose a new PIN, Dani");
    const reset = await send(`/h/${code}/reset/${ids.Dani}`, { form: { code: loose, pin: "5678" } });
    expect(reset.status).toBe(303);
    expect(reset.headers.get("location")).toBe(`/h/${code}`);
    const old = await send(`/h/${code}`, { cookie: cookies.Dani });
    expect(old.headers.get("location")).toBe(`/h/${code}/join`);
    expect(textOf(await housePage(code, cookieOf(reset)))).toContain("you are Dani");
    expect(textOf(await housePage(code, cookies.Ana))).toContain("Dani's PIN was changed");
    expect((await signInAs(code, ids.Dani, "1234")).status).toBe(401);
    expect((await signInAs(code, ids.Dani, "5678")).status).toBe(303);
  });

  it("refuses a reset with the wrong house code or a bad PIN, and keeps the PIN", async () => {
    const { code, ids } = await setUpHouse("Dani");
    const forms: Record<string, string>[] = [{ code: "ZZZZZZ" }, { code: "ZZZZZZ", pin: "5678" }, { code: "", pin: "5678" }];
    for (const form of forms) {
      const res = await send(`/h/${code}/reset/${ids.Dani}`, { form });
      expect(res.status, JSON.stringify(form)).toBe(400);
      expect(textOf(await res.text())).toContain("That isn't this house's code");
    }
    const bad = await send(`/h/${code}/reset/${ids.Dani}`, { form: { code, pin: "56" } });
    expect(bad.status).toBe(400);
    expect(textOf(await bad.text())).toContain("Pick a 4-digit PIN");
    expect((await signInAs(code, ids.Dani, "1234")).status).toBe(303);
  });
});
