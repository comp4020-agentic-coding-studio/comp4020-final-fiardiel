import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { createHandler } from "../../src/app.ts";
import { Hub } from "../../src/live.ts";
import { ScanLimit, checkReading } from "../../src/receipt.ts";
import type { ReadReceipt } from "../../src/receipt.ts";
import { Store } from "../../src/store.ts";

describe("checkReading", () => {
  const good = {
    shop: "Coles Civic",
    total_cents: 1862,
    items: [{ name: "Milk 2L", cents: 310, discount_cents: 100 }],
    fees: [{ name: "Card surcharge", cents: 12 }],
    gst_cents: 32,
  };

  it("keeps a sound reading, in whole cents: items with their own discounts, shared fees, and GST", () => {
    expect(checkReading(good)).toEqual({
      shop: "Coles Civic",
      totalCents: 1862,
      items: [{ name: "Milk 2L", cents: 310, off: 100 }],
      fees: [{ name: "Card surcharge", cents: 12 }],
      gstCents: 32,
    });
  });

  it("refuses totals that aren't positive whole cents", () => {
    for (const total_cents of [0, -5, 12.5, "1850", 100_000_001]) {
      expect(checkReading({ ...good, total_cents })).toBeNull();
    }
  });

  it("keeps discount lines and credits, but drops lines that aren't whole cents", () => {
    const items = [{ name: "Discount", cents: -200, discount_cents: 0 }, { name: "Odd", cents: 1.5, discount_cents: 0 }, { name: "Bread", cents: 450, discount_cents: 0.5 }];
    const fees = [{ name: "Rounding", cents: -2 }, { name: "Odd fee", cents: "3" }];
    const reading = checkReading({ ...good, items, fees });
    expect(reading?.items).toEqual([{ name: "Discount", cents: -200, off: 0 }, { name: "Bread", cents: 450, off: 0 }]);
    expect(reading?.fees).toEqual([{ name: "Rounding", cents: -2 }]);
  });

  it("treats missing fees and GST as none", () => {
    expect(checkReading({ shop: "x", total_cents: 100, items: [] })).toEqual({ shop: "x", totalCents: 100, items: [], fees: [], gstCents: 0 });
  });

  it("cleans names like any typed text: trimmed, shortened, control characters refused", () => {
    const items = [{ name: `  ${"x".repeat(100)}  `, cents: 1 }, { name: "bad\u0007", cents: 1 }];
    const reading = checkReading({ ...good, shop: "Coles\u202e", items, fees: [{ name: "<b>fee</b>\u0007", cents: 5 }] });
    expect(reading?.shop).toBe("");
    expect(reading?.items).toEqual([{ name: "x".repeat(60), cents: 1, off: 0 }]);
    expect(reading?.fees).toEqual([]);
  });

  it("refuses something that isn't a reading at all", () => {
    for (const raw of [null, "receipt", [], { shop: "x" }]) expect(checkReading(raw)).toBeNull();
  });
});

describe("ScanLimit", () => {
  it("allows each house its own few a day, and more the next day", () => {
    const limit = new ScanLimit(2);
    const day = new Date("2026-10-29T03:00:00Z");
    expect([limit.take("AAAAAA", day), limit.take("AAAAAA", day), limit.take("AAAAAA", day)]).toEqual([true, true, false]);
    expect(limit.take("BBBBBB", day)).toBe(true);
    expect(limit.take("AAAAAA", new Date("2026-10-30T03:00:00Z"))).toBe(true);
  });
});

// The handler with a fake reader in place of Claude: what a scan does to the
// bill form, and what it must never do.
describe("POST /h/<code>/receipt", () => {
  const open: { close: () => void }[] = [];
  afterEach(() => {
    while (open.length > 0) open.pop()!.close();
  });

  async function app(read: ReadReceipt, perDay = 5) {
    const store = new Store(":memory:");
    const listed = store.createHouse();
    const other = store.createHouse();
    const join = (code: string, name: string): string => {
      const outcome = store.join(code, name, "1234");
      if (!outcome.ok) throw new Error(outcome.reason);
      return `person_${code}=${outcome.token}`;
    };
    const rafi = join(listed, "Rafi");
    const dina = join(listed, "Dina");
    const elsewhere = join(other, "Ari");
    const server = createServer(createHandler(store, new Hub(), { houses: new Set([listed]), limit: new ScanLimit(perDay), read }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    open.push({ close: () => (server.close(), store.close()) });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const scan = (code: string, cookie: string, type = "image/jpeg") => {
      const form = new FormData();
      form.append("photo", new Blob([new Uint8Array([1, 2, 3])], { type }), "receipt");
      return fetch(`${base}/h/${code}/receipt`, { method: "POST", headers: { cookie }, body: form, redirect: "manual" });
    };
    return { store, listed, other, rafi, dina, elsewhere, base, scan };
  }

  const reading = {
    shop: "Coles <b>Civic</b>",
    totalCents: 1850,
    items: [
      { name: "Milk <i>2L</i>", cents: 310, off: 0 },
      { name: "Kecap", cents: 520, off: 0 },
    ],
    fees: [],
    gstCents: 0,
  };
  // The same shop with a promo on the milk, a card surcharge and GST, adding up to its total.
  const withExtras = {
    ...reading,
    totalCents: 842,
    items: [
      { name: "Milk <i>2L</i>", cents: 310, off: 100 },
      { name: "Kecap", cents: 520, off: 0 },
    ],
    fees: [{ name: "Card surcharge", cents: 12 }],
    gstCents: 32,
  };
  const doc = (html: string) => new JSDOM(html).window.document;
  // Each housemate's tab: their name ("You" for the payer) and their share.
  const sharesOf = (d: Document) => [...d.querySelectorAll(".pick-body")].map((t) => t.textContent?.replace(/\s+/g, " ").trim());
  const partOf = (d: Document, line: number, person: number) => d.querySelector(`[data-part="${line}-${person}"]`)?.textContent;
  // The bill form as a browser would post it: ticked boxes only.
  const formOf = (d: Document): URLSearchParams => {
    const form = new URLSearchParams();
    for (const input of d.querySelectorAll<HTMLInputElement>("form[action$='/bill'] input[name]")) {
      if ((input.type !== "checkbox" && input.type !== "radio") || input.checked) form.append(input.name, input.value);
    }
    return form;
  };
  const ids = (store: Store, code: string) => Object.fromEntries(store.people(code).map((p) => [p.name, p.id] as const));

  it("lists each line with nobody ticked yet, and adds no bill", async () => {
    const seen: string[] = [];
    const { store, listed, rafi, scan } = await app(async (_image, type) => (seen.push(type), reading));
    const res = await scan(listed, rafi);
    expect(res.status).toBe(200);
    const d = doc(await res.text());
    const { Rafi, Dina } = ids(store, listed);
    expect(d.querySelector<HTMLInputElement>('input[name="note"]')?.value).toBe("Coles <b>Civic</b>");
    expect(d.querySelector<HTMLInputElement>('input[name="item_name_0"]')?.value).toBe("Milk <i>2L</i>");
    expect(d.querySelector<HTMLInputElement>('input[name="item_price_1"]')?.value).toBe("5.20");
    expect(d.querySelector<HTMLInputElement>(`input[name="item_0_with_${Rafi}"]`)?.checked).toBe(false);
    expect(d.querySelector<HTMLInputElement>(`input[name="item_1_with_${Dina}"]`)?.checked).toBe(false);
    expect(d.querySelector("form[action$='/bill'] i")).toBeNull();
    // Typed amounts are for bills typed in by hand only.
    expect(d.querySelector('input[name^="amount_"]')).toBeNull();
    // In name order, like everything else.
    // Until someone is given a line, it counts as the payer's own.
    expect(sharesOf(d)).toEqual(["Dina $0.00", "You $8.30"]);
    expect(partOf(d, 1, Dina)).toBe("Nobody yet");
    // The bar at the bottom says how much is still to give out.
    expect(d.querySelector(".dock")?.textContent).toContain("2 lines left");
    expect(d.querySelector(".dock")?.textContent).toContain("$8.30 counts as yours");
    // The first person's list is open.
    expect(d.querySelector<HTMLInputElement>(`#show-${Dina}`)?.checked).toBe(true);
    expect(d.querySelector("[data-check]")?.textContent).toContain("the receipt says $18.50");
    expect(seen).toEqual(["image/jpeg"]);
    expect(store.bills(listed)).toEqual([]);
  });

  it("works out new shares when the payer changes a price or a tick, still adding nothing", async () => {
    const { store, listed, rafi, base, scan } = await app(async () => reading);
    const { Dina } = ids(store, listed);
    const form = formOf(doc(await (await scan(listed, rafi)).text()));
    form.set(`item_0_with_${Dina}`, "on");
    form.set(`item_0_with_${ids(store, listed).Rafi}`, "on");
    form.set(`item_1_with_${ids(store, listed).Rafi}`, "on");
    form.set("item_price_0", "3.20");
    form.set("showing", String(ids(store, listed).Rafi));
    form.set("intent", "items");
    const res = await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form });
    expect(res.status).toBe(200);
    const d = doc(await res.text());
    expect(sharesOf(d)).toEqual(["Dina $1.60", "You $6.80"]);
    expect(partOf(d, 1, Dina)).toBe("");
    expect(partOf(d, 1, ids(store, listed).Rafi)).toBe("All $5.20");
    // Whoever's list was open stays open.
    expect(d.querySelector<HTMLInputElement>(`#show-${ids(store, listed).Rafi}`)?.checked).toBe(true);
    expect(store.bills(listed)).toEqual([]);
  });

  it("adds the bill from the items and ticks, ignoring any amounts sent with them, and keeps the items", async () => {
    const { store, listed, rafi, dina, base, scan } = await app(async () => reading);
    const { Rafi, Dina } = ids(store, listed);
    const form = formOf(doc(await (await scan(listed, rafi)).text()));
    form.set(`item_0_with_${Dina}`, "on");
    form.set(`item_0_with_${Rafi}`, "on");
    form.set(`item_1_with_${Rafi}`, "on");
    form.set(`amount_${Dina}`, "999");
    form.set("intent", "add");
    const res = await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form, redirect: "manual" });
    expect(res.status).toBe(303);
    const [bill] = store.bills(listed);
    expect(bill.shares).toEqual([
      { personId: Dina, cents: 155 },
      { personId: Rafi, cents: 155 + 520 },
    ]);
    expect(bill.items).toEqual([
      { name: "Milk <i>2L</i>", cents: 310, people: [Dina, Rafi] },
      { name: "Kecap", cents: 520, people: [Rafi] },
    ]);
    // Dina's history says what she had and her part of it, then the whole receipt.
    const history = doc(await (await fetch(`${base}/h/${listed}`, { headers: { cookie: dina } })).text());
    const mine = [...history.querySelectorAll(".bought > ul li")].map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(mine).toEqual(["Milk <i>2L</i>$1.55Your part of $3.10, with Rafi"]);
    expect(history.querySelector(".bought details")?.textContent).toContain("Kecap");
  });

  it("a line nobody had counts as the payer's own, so the bill covers the whole receipt", async () => {
    const { store, listed, rafi, base, scan } = await app(async () => reading);
    const { Rafi } = ids(store, listed);
    const form = formOf(doc(await (await scan(listed, rafi)).text()));
    form.set("intent", "add");
    expect((await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form, redirect: "manual" })).status).toBe(303);
    const [bill] = store.bills(listed);
    expect(bill.shares).toEqual([{ personId: Rafi, cents: 830 }]);
    expect(bill.items.map((i) => i.people)).toEqual([[Rafi], [Rafi]]);
  });

  it("updates the shares and faces on the page as lines are tapped, the same as the server works them out", async () => {
    const { store, listed, rafi, scan } = await app(async () => reading);
    const { Dina, Rafi } = ids(store, listed);
    const page = new JSDOM(await (await scan(listed, rafi)).text(), { runScripts: "dangerously" });
    const d = page.window.document;
    const tap = (line: number, person: number) => {
      const box = d.querySelector<HTMLInputElement>(`input[name="item_${line}_with_${person}"]`)!;
      box.checked = !box.checked;
      box.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    };
    tap(0, Dina);
    tap(0, Rafi);
    tap(1, Rafi);
    // The same numbers the server saves for this bill (see the check above).
    expect(sharesOf(d)).toEqual(["Dina $1.55", "You $6.75"]);
    expect(partOf(d, 1, Dina)).toBe("");
    // Every list shows the same faces on a line: who has it so far.
    const faces = (line: number, panel: number) => d.querySelectorAll(`#panel-${panel} [data-stack="${line}"] .avatar`).length;
    expect([faces(0, Dina), faces(0, Rafi), faces(1, Dina)]).toEqual([2, 2, 1]);
    expect(d.querySelector("[data-left]")?.textContent).toBe("Every line is split");
    const price = d.querySelector<HTMLInputElement>('input[name="item_price_0"]')!;
    price.value = "-1.00";
    price.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(sharesOf(d)).toEqual(["Dina -$0.50", "You $4.70"]);
  });

  it("shows a discount on its line, shares fees in proportion, notes GST, and checks the total", async () => {
    const { store, listed, rafi, dina, base, scan } = await app(async () => withExtras);
    const { Rafi, Dina } = ids(store, listed);
    const d = doc(await (await scan(listed, rafi)).text());
    expect(d.querySelector(".was")?.textContent).toBe("Was $4.10, $1.00 off");
    expect(d.querySelector(".extras")?.textContent).toContain("Card surcharge$0.12");
    expect(d.querySelector(".extras")?.textContent).toContain("GST of $0.32 is already in the prices.");
    expect(d.querySelector("[data-check]")?.textContent).toBe("Lines and fees add up to $8.42, the same as the receipt.");
    const form = formOf(d);
    form.set(`item_0_with_${Dina}`, "on");
    form.set(`item_0_with_${Rafi}`, "on");
    form.set(`item_1_with_${Rafi}`, "on");
    form.set("intent", "add");
    expect((await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form, redirect: "manual" })).status).toBe(303);
    const [bill] = store.bills(listed);
    // Lines: Dina 155, Rafi 675. Surcharge 12: Dina 12 × 155/830 = 2.2 → 2, Rafi 9.8 → 9, and the cent left to the payer.
    expect(bill.shares).toEqual([
      { personId: Dina, cents: 157 },
      { personId: Rafi, cents: 685 },
    ]);
    expect(bill.fees).toEqual([{ name: "Card surcharge", cents: 12 }]);
    const history = doc(await (await fetch(`${base}/h/${listed}`, { headers: { cookie: dina } })).text());
    const mine = [...history.querySelectorAll(".bought > ul li")].map((li) => li.textContent?.replace(/\s+/g, " ").trim());
    expect(mine).toEqual([
      "Milk <i>2L</i>$1.55Your part of $3.10, with Rafi",
      "Shared fees$0.02Your part of Card surcharge, in proportion to what you had",
    ]);
  });

  it("works out fees on the page the same as the server", async () => {
    const { store, listed, rafi, scan } = await app(async () => withExtras);
    const { Dina, Rafi } = ids(store, listed);
    const page = new JSDOM(await (await scan(listed, rafi)).text(), { runScripts: "dangerously" });
    const d = page.window.document;
    for (const [line, person] of [[0, Dina], [0, Rafi], [1, Rafi]]) {
      const box = d.querySelector<HTMLInputElement>(`input[name="item_${line}_with_${person}"]`)!;
      box.checked = true;
      box.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    }
    // The same as the bill the server saved in the check above.
    expect(sharesOf(d)).toEqual(["Dina $1.57", "You $6.85"]);
    const fee = d.querySelector<HTMLInputElement>('input[name="fee_price_0"]')!;
    fee.value = "0.20";
    fee.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(d.querySelector("[data-check]")?.textContent).toContain("but the receipt says $8.42");
  });

  it("shares every line with everyone, or only the lines nobody has yet, and adds nothing", async () => {
    const { store, listed, rafi, base, scan } = await app(async () => reading);
    const { Dina, Rafi } = ids(store, listed);
    const send = async (form: URLSearchParams) =>
      doc(await (await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form })).text());
    const checked = (d: Document) =>
      [0, 1].map((line) => [Dina, Rafi].filter((p) => d.querySelector<HTMLInputElement>(`input[name="item_${line}_with_${p}"]`)?.checked));

    const all = formOf(doc(await (await scan(listed, rafi)).text()));
    all.set("intent", "everyone");
    expect(checked(await send(all))).toEqual([[Dina, Rafi], [Dina, Rafi]]);

    const rest = formOf(doc(await (await scan(listed, rafi)).text()));
    rest.set(`item_1_with_${Rafi}`, "on");
    rest.set("intent", "rest");
    const d = await send(rest);
    // Kecap was given to Rafi, so only the milk is shared out.
    expect(checked(d)).toEqual([[Dina, Rafi], [Rafi]]);
    expect(d.querySelector("[data-left]")?.textContent).toBe("Every line is split");
    expect(d.querySelector<HTMLElement>("[data-rest]")?.hidden).toBe(true);
    expect(store.bills(listed)).toEqual([]);
  });

  it("shares lines evenly on the page too, the same as the server", async () => {
    const { store, listed, rafi, scan } = await app(async () => reading);
    const { Rafi } = ids(store, listed);
    const page = new JSDOM(await (await scan(listed, rafi)).text(), { runScripts: "dangerously" });
    const d = page.window.document;
    const box = d.querySelector<HTMLInputElement>(`input[name="item_1_with_${Rafi}"]`)!;
    box.checked = true;
    box.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    d.querySelector<HTMLButtonElement>("[data-rest]")!.click();
    // Milk split two ways (155 each); kecap all Rafi's.
    expect(sharesOf(d)).toEqual(["Dina $1.55", "You $6.75"]);
    expect(d.querySelector<HTMLElement>("[data-rest]")?.hidden).toBe(true);
    d.querySelector<HTMLButtonElement>("[data-all]")!.click();
    expect(sharesOf(d)).toEqual(["Dina $4.15", "You $4.15"]);
  });

  it("refuses a price that isn't dollars, and keeps what was there", async () => {
    const { store, listed, rafi, base, scan } = await app(async () => reading);
    const form = formOf(doc(await (await scan(listed, rafi)).text()));
    form.set("item_price_1", "five");
    form.set("intent", "add");
    const res = await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form });
    expect(res.status).toBe(400);
    const d = doc(await res.text());
    expect(d.querySelector('[role="alert"]')?.textContent).toContain("Kecap");
    expect(d.querySelector<HTMLInputElement>('input[name="item_name_0"]')?.value).toBe("Milk <i>2L</i>");
    expect(store.bills(listed)).toEqual([]);
  });

  it("is not there for a house that isn't on the list", async () => {
    let calls = 0;
    const { base, other, elsewhere, scan } = await app(async () => (calls++, reading));
    expect(await (await fetch(`${base}/h/${other}/bill`, { headers: { cookie: elsewhere } })).text()).not.toContain('type="file"');
    expect((await scan(other, elsewhere)).status).toBe(404);
    expect(calls).toBe(0);
  });

  it("shows the upload in a listed house", async () => {
    const { base, listed, rafi } = await app(async () => reading);
    expect(await (await fetch(`${base}/h/${listed}/bill`, { headers: { cookie: rafi } })).text()).toContain('type="file"');
  });

  it("stops at the daily limit without calling Claude", async () => {
    let calls = 0;
    const { listed, rafi, scan } = await app(async () => (calls++, reading), 1);
    expect((await scan(listed, rafi)).status).toBe(200);
    const res = await scan(listed, rafi);
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("Type the amounts instead");
    expect(calls).toBe(1);
  });

  it("refuses a file that isn't a photo, without calling Claude", async () => {
    let calls = 0;
    const { listed, rafi, scan } = await app(async () => (calls++, reading));
    expect((await scan(listed, rafi, "application/pdf")).status).toBe(400);
    expect(calls).toBe(0);
  });

  it("says so when the receipt can't be read, and leaves the form for typing", async () => {
    const { listed, rafi, scan } = await app(async () => {
      throw new Error("API down");
    });
    const res = await scan(listed, rafi);
    expect(res.status).toBe(502);
    expect(doc(await res.text()).body.textContent).toContain("couldn't read that receipt");
  });

  it("needs someone signed in to the house", async () => {
    let calls = 0;
    const { listed, scan } = await app(async () => (calls++, reading));
    expect((await scan(listed, "")).status).toBe(303);
    expect(calls).toBe(0);
  });
});
