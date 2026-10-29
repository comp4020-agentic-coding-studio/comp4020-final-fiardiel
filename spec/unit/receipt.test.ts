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
  const good = { shop: "Coles Civic", total_cents: 1850, items: [{ name: "Milk 2L", cents: 310 }] };

  it("keeps a sound reading, in whole cents", () => {
    expect(checkReading(good)).toEqual({ shop: "Coles Civic", totalCents: 1850, items: [{ name: "Milk 2L", cents: 310 }] });
  });

  it("refuses totals that aren't positive whole cents", () => {
    for (const total_cents of [0, -5, 12.5, "1850", 100_000_001]) {
      expect(checkReading({ ...good, total_cents })).toBeNull();
    }
  });

  it("keeps discount lines, but drops items that aren't whole cents", () => {
    const items = [{ name: "Discount", cents: -200 }, { name: "Odd", cents: 1.5 }, { name: "Bread", cents: 450 }];
    expect(checkReading({ ...good, items })?.items).toEqual([{ name: "Discount", cents: -200 }, { name: "Bread", cents: 450 }]);
  });

  it("cleans names like any typed text: trimmed, shortened, control characters refused", () => {
    const items = [{ name: `  ${"x".repeat(100)}  `, cents: 1 }, { name: "bad\u0007", cents: 1 }];
    const reading = checkReading({ ...good, shop: "Coles‮", items });
    expect(reading?.shop).toBe("");
    expect(reading?.items).toEqual([{ name: "x".repeat(60), cents: 1 }]);
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
    join(listed, "Dina");
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
    return { store, listed, other, rafi, elsewhere, base, scan };
  }

  const reading = { shop: "Coles <b>Civic</b>", totalCents: 1850, items: [{ name: "Milk <i>2L</i>", cents: 310 }] };
  const doc = (html: string) => new JSDOM(html).window.document;

  it("fills the bill form from the receipt, and adds no bill", async () => {
    const seen: string[] = [];
    const { store, listed, rafi, scan } = await app(async (_image, type) => (seen.push(type), reading));
    const res = await scan(listed, rafi);
    expect(res.status).toBe(200);
    const d = doc(await res.text());
    expect(d.querySelector<HTMLInputElement>('input[name="note"]')?.value).toBe("Coles <b>Civic</b>");
    expect(d.querySelector<HTMLInputElement>('input[name="total"]')?.value).toBe("18.50");
    expect([...d.querySelectorAll(".items li")].map((li) => li.textContent?.trim())).toEqual(["Milk <i>2L</i> $3.10"]);
    expect(d.querySelector(".items i")).toBeNull();
    expect(seen).toEqual(["image/jpeg"]);
    expect(store.bills(listed)).toEqual([]);
  });

  it("keeps the items through Split equally", async () => {
    const { listed, rafi, base, scan } = await app(async () => reading);
    const d = doc(await (await scan(listed, rafi)).text());
    const form = new URLSearchParams();
    for (const input of d.querySelectorAll<HTMLInputElement>("form[action$='/bill'] input[name]")) {
      if (input.type !== "checkbox" || input.checked) form.append(input.name, input.value);
    }
    form.set("intent", "fill");
    const res = await fetch(`${base}/h/${listed}/bill`, { method: "POST", headers: { cookie: rafi }, body: form });
    expect([...doc(await res.text()).querySelectorAll(".items li")].map((li) => li.textContent?.trim())).toEqual(["Milk <i>2L</i> $3.10"]);
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
