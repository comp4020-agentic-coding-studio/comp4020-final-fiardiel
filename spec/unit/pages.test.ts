import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { esc, homePage, housePage, joinPage, layout } from "../../src/pages.ts";
import type { HouseView } from "../../src/pages.ts";

const dani = { id: 1, name: "Dani" };
const rafi = { id: 2, name: "Rafi" };
const ari = { id: 3, name: "Ari" };

const doc = (html: string) => new JSDOM(html).window.document;
const text = (html: string): string => doc(html).body.textContent ?? "";
const buttons = (html: string): string[] =>
  [...doc(html).querySelectorAll("button")].map((b) => b.textContent ?? "");

describe("esc", () => {
  it("escapes the characters that matter in HTML text and attributes", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("layout", () => {
  it("is a phone-ready page that links to the README", () => {
    const d = doc(layout("Hello", "<p>hi</p>"));
    expect(d.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(d.querySelector('a[href="/readme/"]')).not.toBeNull();
    expect(d.title).toBe("Hello");
  });
});

const house = (over: Partial<HouseView> = {}): HouseView => ({
  code: "ABC234",
  me: rafi,
  people: [ari, dani, rafi],
  balances: [],
  toAnswer: [],
  waiting: [],
  history: [],
  ...over,
});
const live = (html: string) => doc(html).querySelector("#live");
const items = (html: string, selector: string): string[] =>
  [...doc(html).querySelectorAll(selector)].map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim());

describe("house page", () => {
  it("says who you are and links to the join page", () => {
    const html = housePage(house());
    expect(text(html)).toContain("you are Rafi");
    expect(doc(html).querySelector('a[href="/h/ABC234/join"]')).not.toBeNull();
  });

  it("states balances plainly, in name order, never ranked by amount", () => {
    const html = housePage(
      house({
        balances: [
          { person: ari, cents: 100 },
          { person: dani, cents: -900 },
        ],
      }),
    );
    expect(items(html, "#balances li")).toEqual(["Ari owes you $1.00", "You owe Dani $9.00"]);
  });

  it("says when nobody owes anybody", () => {
    expect(text(housePage(house()))).toContain("Nobody owes anybody.");
  });

  it("asks you about payments made to you, with a button each way", () => {
    const html = housePage(house({ toAnswer: [{ id: 7, from: dani, cents: 1550 }] }));
    expect(text(html)).toContain("Dani says they paid you $15.50");
    expect(buttons(html)).toEqual(expect.arrayContaining(["Got it", "Didn't get it"]));
    const form = [...doc(html).querySelectorAll("form")].find((f) => f.textContent === "Got it")!;
    expect(form.getAttribute("action")).toBe("/h/ABC234/answer");
    expect(form.querySelector<HTMLInputElement>('input[name="payment"]')!.value).toBe("7");
  });

  it("shows payments you made that are still waiting", () => {
    expect(text(housePage(house({ waiting: [{ to: dani, cents: 500 }] })))).toContain("You paid Dani $5.00");
  });

  it("lists the history, with delete only on your own bills", () => {
    const html = housePage(
      house({
        history: [
          { kind: "payment", from: dani, to: rafi, cents: 500, pending: true },
          { kind: "bill", id: 2, paidBy: dani, note: "", shares: [{ person: rafi, cents: 300 }], mine: false },
          {
            kind: "bill",
            id: 1,
            paidBy: rafi,
            note: "Woolies",
            shares: [
              { person: ari, cents: 900 },
              { person: dani, cents: 450 },
            ],
            mine: true,
          },
        ],
      }),
    );
    const lines = items(html, "#history li");
    expect(lines[0]).toContain("Dani paid Rafi $5.00");
    expect(lines[0]).toContain("waiting for Rafi");
    expect(lines[1]).toContain("Dani paid $3.00 for a bill: Rafi $3.00");
    expect(lines[2]).toContain("Rafi paid $13.50 for Woolies: Ari $9.00, Dani $4.50");
    const deletes = [...doc(html).querySelectorAll('form[action="/h/ABC234/delete"]')];
    expect(deletes.map((f) => f.querySelector<HTMLInputElement>('input[name="bill"]')!.value)).toEqual(["1"]);
  });

  it("shows names and notes as text, never as markup", () => {
    const evil = { id: 4, name: "<b>x</b>" };
    const html = housePage(
      house({
        people: [evil, rafi],
        balances: [{ person: evil, cents: 100 }],
        history: [{ kind: "bill", id: 1, paidBy: evil, note: "<i>n</i>", shares: [{ person: rafi, cents: 100 }], mine: false }],
        draft: { note: "<i>n</i>", total: "", amounts: {}, ticked: [], message: "<b>x</b>'s amount" },
      }),
    );
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>n</i>");
    expect(text(html)).toContain("<b>x</b> owes you $1.00");
  });

  it("keeps the forms outside the live section, so an update never wipes them", () => {
    const html = housePage(house());
    expect(live(html)!.getAttribute("data-base")).toBe("/h/ABC234");
    expect(doc(html).querySelector('form[action="/h/ABC234/bill"]')).not.toBeNull();
    expect(doc(html).querySelector('form[action="/h/ABC234/pay"]')).not.toBeNull();
    expect(live(html)!.querySelector('form[action="/h/ABC234/bill"], form[action="/h/ABC234/pay"]')).toBeNull();
  });

  it("listens for changes and re-fetches on every reconnect", () => {
    const script = doc(housePage(house())).querySelector("script")?.textContent ?? "";
    expect(script).toContain("EventSource");
    expect(script).toContain('"changed"');
    expect(script).toContain('"open"');
  });

  it("offers an amount box and a tick for everyone, ticked by default", () => {
    const d = doc(housePage(house()));
    for (const p of [ari, dani, rafi]) {
      expect(d.querySelector(`input[name="amount_${p.id}"]`), p.name).not.toBeNull();
      expect(d.querySelector<HTMLInputElement>(`input[name="with_${p.id}"]`)!.checked, p.name).toBe(true);
    }
  });

  it("refills the bill form from a draft, with its message", () => {
    const d = doc(
      housePage(
        house({
          draft: { note: "Woolies", total: "10", amounts: { 3: "3.33", 1: "", 2: "3.34" }, ticked: [3, 2], message: "Check the amounts" },
        }),
      ),
    );
    expect(d.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("Woolies");
    expect(d.querySelector<HTMLInputElement>('input[name="amount_3"]')!.value).toBe("3.33");
    expect(d.querySelector<HTMLInputElement>('input[name="with_1"]')!.checked).toBe(false);
    expect(d.querySelector('[role="alert"]')!.textContent).toBe("Check the amounts");
  });

  it("offers to pay only other people, and says so when you're alone", () => {
    const d = doc(housePage(house()));
    expect([...d.querySelectorAll('select[name="to"] option')].map((o) => o.textContent)).toEqual(["Ari", "Dani"]);
    expect(text(housePage(house({ people: [rafi] })))).toContain("Nobody else is in the house yet");
  });

  it("never nags", () => {
    const html = housePage(
      house({
        balances: [{ person: dani, cents: -900 }],
        waiting: [{ to: ari, cents: 100 }],
        toAnswer: [{ id: 1, from: dani, cents: 100 }],
      }),
    );
    expect(text(html)).not.toMatch(/\b(overdue|late|remind|reminder|urgent)\b/i);
  });
});

describe("join page", () => {
  it("shows the house code and lets existing names be claimed", () => {
    const html = joinPage("ABC234", [dani, rafi]);
    expect(text(html)).toContain("ABC234");
    expect(buttons(html)).toEqual(["Join", "Dani", "Rafi"]);
  });

  it("escapes names and messages", () => {
    const html = joinPage("ABC234", [{ id: 9, name: "<b>x</b>" }], "<i>careful</i>");
    expect(doc(html).querySelector("b")).toBeNull();
    expect(doc(html).querySelector("i")).toBeNull();
    expect(text(html)).toContain("<b>x</b>");
  });

  it("recognises a returning person, only when told who they are", () => {
    const known = joinPage("ABC234", [dani], undefined, dani);
    expect(text(known)).toContain("You're already in this house as Dani");
    expect(doc(known).querySelector('a[href="/h/ABC234"]')).not.toBeNull();
    expect(buttons(known)).toEqual(["Join", "Dani"]); // the other forms stay
    const unknown = joinPage("ABC234", [dani]);
    expect(text(unknown)).not.toContain("already in this house");
    expect(doc(unknown).querySelector('a[href="/h/ABC234"]')).toBeNull();
  });

  it("escapes the name of a returning person", () => {
    const html = joinPage("ABC234", [], undefined, { id: 9, name: "<b>x</b>" });
    expect(doc(html).querySelector("strong b")).toBeNull();
    expect(doc(html).querySelector("b")).toBeNull();
    expect(text(html)).toContain("<b>x</b>");
  });

  it("has no claim list for an empty house", () => {
    expect(buttons(joinPage("ABC234", []))).toEqual(["Join"]);
  });
});

describe("home page", () => {
  it("offers to start or join a house", () => {
    expect(buttons(homePage())).toEqual(["Start a new house", "Join"]);
  });

  it("lists your houses only when there are some, linking to each", () => {
    expect(text(homePage())).not.toContain("Your houses");
    expect(text(homePage("oops", []))).not.toContain("Your houses");
    const html = homePage(undefined, [
      { code: "ABC234", name: "Dani" },
      { code: "XYZ789", name: "Rafi" },
    ]);
    expect(text(html)).toContain("Your houses");
    expect(doc(html).querySelector('a[href="/h/ABC234"]')?.textContent).toBe("ABC234");
    expect(doc(html).querySelector('a[href="/h/XYZ789"]')).not.toBeNull();
    expect(text(html)).toContain("as Dani");
  });

  it("escapes the names in your houses", () => {
    const html = homePage(undefined, [{ code: "ABC234", name: "<b>x</b>" }]);
    expect(doc(html).querySelector("b")).toBeNull();
    expect(text(html)).toContain("<b>x</b>");
  });

  it("shows a message when given one", () => {
    expect(text(homePage("No such house"))).toContain("No such house");
  });

  it("credits the Serumah bot this app is based on, and its maker", () => {
    const html = homePage();
    expect(text(html)).toContain("Based on Serumah, the Telegram bot by davinpwk");
    expect(doc(html).querySelector('a[href="https://github.com/davinpwk"]')?.textContent).toBe("davinpwk");
  });
});

describe("live script", () => {
  // Runs the page's own script in jsdom with a stand-in EventSource and timers
  // that fire at once, so reconnecting can be watched without a server. `next`
  // is what the page gets when it fetches itself again.
  function run(next: string = housePage(house())) {
    const sources: { url: string; readyState: number; listeners: Record<string, (() => void)[]> }[] = [];
    class FakeEventSource {
      static CLOSED = 2;
      url: string;
      readyState = 0;
      listeners: Record<string, (() => void)[]> = {};
      constructor(url: string) {
        this.url = url;
        sources.push(this);
      }
      addEventListener(type: string, fn: () => void) {
        (this.listeners[type] ??= []).push(fn);
      }
      close() {
        this.readyState = 2;
      }
    }
    const dom = new JSDOM(housePage(house()), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          EventSource: FakeEventSource,
          fetch: async () => ({ ok: true, text: async () => next }),
          setTimeout: (fn: () => void) => {
            fn();
            return 0;
          },
        });
      },
    });
    const changed = async () => {
      for (const fn of sources[0].listeners.changed ?? []) fn();
      await new Promise((r) => setTimeout(r, 20));
    };
    return { sources, document: dom.window.document, changed };
  }

  it("opens a stream for its own house", () => {
    expect(run().sources.map((s) => s.url)).toEqual(["/h/ABC234/events"]);
  });

  it("starts a new stream when the browser gives up on one", () => {
    const { sources } = run();
    sources[0].readyState = 2;
    for (const fn of sources[0].listeners.error ?? []) fn();
    expect(sources).toHaveLength(2);
    expect(sources[1].url).toBe("/h/ABC234/events");
  });

  it("leaves a stream the browser is still retrying alone", () => {
    const { sources } = run();
    sources[0].readyState = 0;
    for (const fn of sources[0].listeners.error ?? []) fn();
    expect(sources).toHaveLength(1);
  });

  const zoe = { id: 5, name: "Zoe" };
  const withZoe = housePage(house({ people: [ari, dani, rafi, zoe] }));

  it("adds someone who just joined to untouched forms", async () => {
    const { document, changed } = run(withZoe);
    await changed();
    expect(document.querySelector('input[name="amount_5"]')).not.toBeNull();
    expect([...document.querySelectorAll('select[name="to"] option')].map((o) => o.textContent)).toContain("Zoe");
    expect(document.querySelector<HTMLElement>("#stale")!.hidden).toBe(true);
  });

  it("keeps what you typed when someone joins, and says to reload", async () => {
    const { document, changed } = run(withZoe);
    document.querySelector<HTMLInputElement>('input[name="amount_1"]')!.value = "4.50";
    await changed();
    expect(document.querySelector<HTMLInputElement>('input[name="amount_1"]')!.value).toBe("4.50");
    expect(document.querySelector('input[name="amount_5"]')).toBeNull();
    expect(document.querySelector<HTMLElement>("#stale")!.hidden).toBe(false);
  });

  it("leaves the forms alone when nobody joined", async () => {
    const { document, changed } = run();
    const form = document.querySelector('form[action="/h/ABC234/bill"]');
    await changed();
    expect(document.querySelector('form[action="/h/ABC234/bill"]')).toBe(form);
    expect(document.querySelector<HTMLElement>("#stale")!.hidden).toBe(true);
  });
});
