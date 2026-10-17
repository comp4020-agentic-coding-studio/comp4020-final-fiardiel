import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  billPage,
  esc,
  historyPage,
  homePage,
  housePage,
  joinPage,
  layout,
  newNamePage,
  newPinPage,
  payPage,
  pinPage,
  resetCodePage,
  resetPinPage,
} from "../../src/pages.ts";
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

  it("splits balances into what is owed to you and what you owe, with totals", () => {
    const html = housePage(
      house({
        balances: [
          { person: ari, cents: 100 },
          { person: dani, cents: -900 },
          { person: rafi, cents: 250 },
        ],
      }),
    );
    expect(items(html, "#owed li")).toEqual(["Ari owes you $1.00", "Rafi owes you $2.50"]);
    expect(items(html, "#owing li")).toEqual(["You owe Dani $9.00"]);
    expect(items(html, "#totals > div")).toEqual(["Owed to you $3.50", "You owe $9.00"]);
  });

  it("gives each housemate an initial that adds no text", () => {
    const html = housePage(house({ balances: [{ person: ari, cents: 100 }] }));
    const avatar = doc(html).querySelector("#owed li .avatar")!;
    expect(avatar.getAttribute("data-initial")).toBe("A");
    expect(avatar.textContent).toBe("");
  });

  it("sets each balance's amount apart, so it can be read at arm's length", () => {
    const html = housePage(
      house({
        balances: [
          { person: ari, cents: 100 },
          { person: dani, cents: -900 },
        ],
      }),
    );
    const rows = [...doc(html).querySelectorAll("#balances li")];
    expect(rows.map((r) => r.querySelector(".amount")?.textContent)).toEqual(["$1.00", "$9.00"]);
    // Both sides use the same row: only the card's colour differs, never size or weight.
    expect(rows.map((r) => r.className)).toEqual(["", ""]);
  });

  it("says when nobody owes anybody", () => {
    expect(text(housePage(house()))).toContain("Nobody owes anybody.");
  });

  // Each history row read as its parts: what it was for, the total, who paid,
  // and the share chips with the side of the money each one is on.
  const entries = (html: string) =>
    [...doc(html).querySelectorAll("#history > li")].map((li) => {
      const t = (sel: string) => (li.querySelector(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        pill: t(".pill"),
        what: t(".what"),
        total: t(".total"),
        by: t(".by"),
        chips: [...li.querySelectorAll(".chip")].map((c) => `${(c.textContent ?? "").trim()}${c.classList.contains("owe") ? " (owe)" : c.classList.contains("owed") ? " (owed)" : ""}`),
      };
    });

  it("lets you say a payment to you never arrived, with a real button, only on payments to you", () => {
    const html = housePage(
      house({
        history: [
          { kind: "payment", id: 7, from: dani, to: rafi, cents: 1550, toMe: true },
          { kind: "payment", id: 8, from: rafi, to: ari, cents: 500, toMe: false },
        ],
      }),
    );
    expect(entries(html).map((e) => [e.pill, e.what, e.total])).toEqual([
      ["Paid", "Dani paid you", "$15.50"],
      ["Paid", "You paid Ari", "$5.00"],
    ]);
    const forms = [...doc(html).querySelectorAll('form[action="/h/ABC234/dispute"]')];
    expect(forms.map((f) => f.querySelector<HTMLInputElement>('input[name="payment"]')!.value)).toEqual(["7"]);
    expect(forms[0].textContent).toBe("Didn't get it");
    expect(forms[0].querySelector("button svg")).not.toBeNull();
  });

  it("asks nobody to confirm anything", () => {
    const html = housePage(house({ history: [{ kind: "payment", id: 7, from: dani, to: rafi, cents: 1550, toMe: true }] }));
    // The page's words only, not its script.
    expect(doc(html).querySelector("main")!.textContent).not.toMatch(/confirm|waiting|did you get/i);
  });

  it("shows bills and payments in one list, newest first, as short receipts", () => {
    const html = housePage(
      house({
        history: [
          { kind: "payment", id: 9, from: dani, to: rafi, cents: 500, toMe: true },
          { kind: "bill", id: 2, paidBy: dani, note: "", shares: [{ person: rafi, cents: 300 }, { person: dani, cents: 300 }], mine: false },
          {
            kind: "bill",
            id: 1,
            paidBy: rafi,
            note: "Woolies",
            shares: [
              { person: ari, cents: 900 },
              { person: dani, cents: 450 },
              { person: rafi, cents: 450 },
            ],
            mine: true,
          },
        ],
      }),
    );
    expect(entries(html)).toEqual([
      { pill: "Paid", what: "Dani paid you", total: "$5.00", by: "", chips: [] },
      { pill: "Bill", what: "Bill", total: "$6.00", by: "Dani paid", chips: ["You $3.00 (owe)", "Dani $3.00"] },
      { pill: "Bill", what: "Woolies", total: "$18.00", by: "You paid", chips: ["Ari $9.00 (owed)", "Dani $4.50 (owed)", "You $4.50"] },
    ]);
    // Bills and payments get pills of their own colour, so the two kinds tell apart at a glance.
    expect([...doc(html).querySelectorAll("#history .pill")].map((p) => p.className)).toEqual(["pill paid", "pill bill", "pill bill"]);
    const deletes = [...doc(html).querySelectorAll('form[action="/h/ABC234/delete"]')];
    expect(deletes.map((f) => f.querySelector<HTMLInputElement>('input[name="bill"]')!.value)).toEqual(["1"]);
    expect(deletes[0].querySelector("button svg")).not.toBeNull();
  });

  it("asks before deleting a bill, so a stray tap deletes nothing", () => {
    const html = housePage(
      house({ history: [{ kind: "bill", id: 1, paidBy: rafi, note: "Woolies", shares: [{ person: ari, cents: 900 }], mine: true }] }),
    );
    const confirm = doc(html).querySelector("#history details.confirm")!;
    expect(confirm.hasAttribute("open")).toBe(false);
    expect(confirm.querySelector("summary")!.textContent).toContain("Delete");
    // The form that deletes sits inside the closed question, behind its own button.
    const form = confirm.querySelector('form[action="/h/ABC234/delete"]')!;
    expect(form.querySelector("button")!.textContent).toBe("Yes, delete");
    expect(confirm.textContent).toContain("Delete this bill for everyone?");
    expect(doc(html).querySelectorAll('form[action="/h/ABC234/delete"]')).toHaveLength(1);
  });


  it("shows names and notes as text, never as markup", () => {
    const evil = { id: 4, name: "<b>x</b>" };
    const view = house({
      people: [evil, rafi],
      balances: [{ person: evil, cents: 100 }],
      history: [{ kind: "bill", id: 1, paidBy: evil, note: "<i>n</i>", shares: [{ person: rafi, cents: 100 }], mine: false }],
    });
    for (const html of [
      housePage(view),
      historyPage(view),
      billPage(view, { note: "<i>n</i>", total: "", amounts: {}, ticked: [], message: "<b>x</b>'s amount" }),
      payPage(view, { to: "4", amount: "<i>n</i>", message: "<b>x</b>" }),
    ]) {
      expect(html).not.toContain("<b>x</b>");
      expect(html).not.toContain("<i>n</i>");
    }
    expect(text(housePage(view))).toContain("<b>x</b> owes you $1.00");
  });

  it("keeps the forms off the house page, behind two buttons", () => {
    const d = doc(housePage(house()));
    expect(d.querySelector('form[action="/h/ABC234/bill"], form[action="/h/ABC234/pay"]')).toBeNull();
    expect(d.querySelector('a[href="/h/ABC234/bill"]')?.textContent).toBe("+ Add a bill");
    expect(d.querySelector('a[href="/h/ABC234/pay"]')?.textContent).toBe("Record a payment");
  });

  const receipts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ kind: "payment" as const, id: i + 1, from: dani, to: rafi, cents: 100 * (i + 1), toMe: true }));

  it("shows the 5 most recent history entries, with the rest a link away", () => {
    const d = doc(housePage(house({ history: receipts(7) })));
    expect(d.querySelectorAll("#history > li")).toHaveLength(5);
    expect(d.querySelector('a[href="/h/ABC234/history"]')?.textContent).toBe("See all history (7)");
    const few = doc(housePage(house({ history: receipts(5) })));
    expect(few.querySelectorAll("#history > li")).toHaveLength(5);
    expect(few.querySelector('a[href="/h/ABC234/history"]')).toBeNull();
  });

  it("listens for changes and re-fetches on every reconnect", () => {
    const script = doc(housePage(house())).querySelector("script")?.textContent ?? "";
    expect(script).toContain("EventSource");
    expect(script).toContain('"changed"');
    expect(script).toContain('"open"');
  });

  it("never nags", () => {
    const html = housePage(
      house({
        balances: [{ person: dani, cents: -900 }],
        history: [{ kind: "payment", id: 1, from: dani, to: rafi, cents: 100, toMe: true }],
      }),
    );
    expect(text(html)).not.toMatch(/\b(overdue|late|remind|reminder|urgent)\b/i);
  });
});

describe("PIN changes in the history", () => {
  it("say plainly whose PIN was changed, as text", () => {
    const html = housePage(house({ history: [{ kind: "pin", person: { id: 9, name: "<b>Dani</b>" } }] }));
    expect(items(html, "#history > li")).toEqual(["<b>Dani</b>'s PIN was changed"]);
    expect(doc(html).querySelector("#history b")).toBeNull();
    expect(doc(html).querySelector("#history .pill")).toBeNull();
  });
});

describe("history page", () => {
  it("lists every entry, live, with a way back", () => {
    const html = historyPage(house({ history: Array.from({ length: 7 }, (_, i) => ({ kind: "payment" as const, id: i + 1, from: dani, to: rafi, cents: 100, toMe: true })) }));
    const d = doc(html);
    expect(d.querySelectorAll("#history > li")).toHaveLength(7);
    expect(d.querySelector('a[href="/h/ABC234"]')?.textContent).toBe("← Back");
    expect(d.querySelector("#live")!.getAttribute("data-page")).toBe("/h/ABC234/history");
    expect(d.querySelector("script")?.textContent).toContain("EventSource");
  });

  it("says so when there is nothing yet", () => {
    expect(text(historyPage(house()))).toContain("No bills yet.");
  });
});

describe("bill page", () => {
  it("offers an amount box and a tick for everyone, ticked by default, with a way back", () => {
    const d = doc(billPage(house()));
    expect(d.querySelector('form[action="/h/ABC234/bill"]')).not.toBeNull();
    expect(d.querySelector('a[href="/h/ABC234"]')?.textContent).toBe("← Back");
    for (const p of [ari, dani, rafi]) {
      expect(d.querySelector(`input[name="amount_${p.id}"]`), p.name).not.toBeNull();
      expect(d.querySelector<HTMLInputElement>(`input[name="with_${p.id}"]`)!.checked, p.name).toBe(true);
    }
  });

  it("refills the form from a draft, with its message", () => {
    const d = doc(
      billPage(house(), { note: "Woolies", total: "10", amounts: { 3: "3.33", 1: "", 2: "3.34" }, ticked: [3, 2], message: "Check the amounts" }),
    );
    expect(d.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("Woolies");
    expect(d.querySelector<HTMLInputElement>('input[name="amount_3"]')!.value).toBe("3.33");
    expect(d.querySelector<HTMLInputElement>('input[name="with_1"]')!.checked).toBe(false);
    expect(d.querySelector('[role="alert"]')!.textContent).toBe("Check the amounts");
  });
});

describe("payment page", () => {
  it("offers to pay only other people, with a way back", () => {
    const d = doc(payPage(house()));
    expect(d.querySelector('form[action="/h/ABC234/pay"]')).not.toBeNull();
    expect([...d.querySelectorAll('select[name="to"] option')].map((o) => o.textContent)).toEqual(["Ari", "Dani"]);
    expect(d.querySelector('a[href="/h/ABC234"]')?.textContent).toBe("← Back");
  });

  it("keeps what was typed, with the message, after a mistake", () => {
    const d = doc(payPage(house(), { to: "1", amount: "lots", message: "Type the amount in dollars, like 15.50." }));
    expect(d.querySelector<HTMLInputElement>('input[name="amount"]')!.value).toBe("lots");
    expect(d.querySelector<HTMLOptionElement>('option[value="1"]')!.selected).toBe(true);
    expect(d.querySelector('[role="alert"]')!.textContent).toBe("Type the amount in dollars, like 15.50.");
  });

  it("says so when you're alone in the house", () => {
    expect(text(payPage(house({ people: [rafi] })))).toContain("Nobody else is in the house yet");
  });
});

describe("who's using Serumah?", () => {
  it("shows one tile per name, each opening that name's PIN page, and a New tile", () => {
    const d = doc(joinPage("ABC234", [dani, rafi]));
    const tiles = [...d.querySelectorAll("a.tile")].map((a) => [a.getAttribute("href"), a.textContent]);
    expect(tiles).toEqual([
      ["/h/ABC234/as/1", "Dani"],
      ["/h/ABC234/as/2", "Rafi"],
      ["/h/ABC234/new", "New"],
    ]);
    expect(buttons(joinPage("ABC234", [dani, rafi]))).toEqual([]);
    expect(text(joinPage("ABC234", []))).toContain("ABC234");
  });

  it("sends this device's own name straight to the house", () => {
    const d = doc(joinPage("ABC234", [dani, rafi], dani));
    expect(d.querySelector('a.tile[href="/h/ABC234"]')?.textContent).toContain("Dani");
    expect(d.querySelector('a.tile[href="/h/ABC234/as/1"]')).toBeNull();
    expect(d.querySelector('a.tile[href="/h/ABC234/as/2"]')).not.toBeNull();
  });

  it("escapes names", () => {
    const html = joinPage("ABC234", [{ id: 9, name: "<b>x</b>" }]);
    expect(doc(html).querySelector("b")).toBeNull();
    expect(text(html)).toContain("<b>x</b>");
  });
});

describe("joining as someone new", () => {
  it("asks for the name alone, keeping what was typed after a mistake", () => {
    const d = doc(newNamePage("ABC234", "<i>Pick a name</i>", "<b>Sam</b>"));
    expect(d.querySelector("form")?.getAttribute("action")).toBe("/h/ABC234/new");
    expect(d.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("<b>Sam</b>");
    expect(d.querySelector('input[name="pin"]')).toBeNull();
    expect(d.querySelector("i")).toBeNull();
    expect(d.querySelector('[role="alert"]')?.textContent).toBe("<i>Pick a name</i>");
  });

  it("then asks for a PIN, carrying the name", () => {
    const d = doc(newPinPage("ABC234", "<b>Sam</b>"));
    expect(d.querySelector("form")?.getAttribute("action")).toBe("/h/ABC234/join");
    expect(d.querySelector<HTMLInputElement>('input[name="name"]')!.type).toBe("hidden");
    expect(d.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("<b>Sam</b>");
    const pin = d.querySelector<HTMLInputElement>('input[name="pin"]')!;
    expect([pin.getAttribute("inputmode"), pin.getAttribute("pattern"), pin.getAttribute("maxlength")]).toEqual(["numeric", "[0-9]{4}", "4"]);
    expect(d.querySelector("b")).toBeNull();
    expect(text(newPinPage("ABC234", "Sam"))).toContain("Choose a PIN, Sam");
  });
});

describe("opening a name", () => {
  it("asks for that name's PIN, with a way to reset it", () => {
    const d = doc(pinPage("ABC234", dani, "That PIN isn't right. Try again."));
    expect(d.querySelector("form")?.getAttribute("action")).toBe("/h/ABC234/as/1");
    expect(text(pinPage("ABC234", dani))).toContain("Dani's PIN");
    expect(d.querySelector('[role="alert"]')?.textContent).toBe("That PIN isn't right. Try again.");
    expect(d.querySelector('a[href="/h/ABC234/reset/1"]')?.textContent).toBe("Forgot my PIN");
    expect(d.querySelector('a[href="/h/ABC234/join"]')).not.toBeNull();
  });

  it("asks for the house code before a new PIN, then carries it", () => {
    const first = doc(resetCodePage("ABC234", dani));
    expect(first.querySelector("form")?.getAttribute("action")).toBe("/h/ABC234/reset/1");
    expect(first.querySelector('input[name="code"]')).not.toBeNull();
    expect(first.querySelector('input[name="pin"]')).toBeNull();
    const second = doc(resetPinPage("ABC234", dani, "abc234"));
    expect(second.querySelector<HTMLInputElement>('input[name="code"]')!.type).toBe("hidden");
    expect(second.querySelector<HTMLInputElement>('input[name="code"]')!.value).toBe("abc234");
    expect(second.querySelector('input[name="pin"]')).not.toBeNull();
    expect(text(resetPinPage("ABC234", dani, "ABC234"))).toContain("Choose a new PIN, Dani");
  });
});

describe("home page", () => {
  it("asks for a house code, with starting a house underneath", () => {
    expect(buttons(homePage())).toEqual(["Go", "Start a new house"]);
  });

  it("lists your houses only when there are some, linking to each", () => {
    expect(text(homePage())).not.toContain("Your houses");
    expect(text(homePage("oops", []))).not.toContain("Your houses");
    const html = homePage(undefined, [
      { code: "ABC234", name: "Dani" },
      { code: "XYZ789", name: "Rafi" },
    ]);
    expect(text(html)).toContain("Your houses");
    expect(doc(html).querySelector('a[href="/h/ABC234"]')?.textContent).toContain("ABC234");
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

  it("keeps an open delete question open when the page updates", async () => {
    const page = housePage(
      house({ history: [{ kind: "bill", id: 1, paidBy: rafi, note: "Woolies", shares: [{ person: ari, cents: 900 }], mine: true }] }),
    );
    const sources: { listeners: Record<string, (() => void)[]> }[] = [];
    const dom = new JSDOM(page, {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          EventSource: class {
            static CLOSED = 2;
            readyState = 0;
            listeners: Record<string, (() => void)[]> = {};
            constructor() {
              sources.push(this);
            }
            addEventListener(type: string, fn: () => void) {
              (this.listeners[type] ??= []).push(fn);
            }
          },
          fetch: async () => ({ ok: true, text: async () => page }),
        });
      },
    });
    dom.window.document.querySelector("details.confirm")!.setAttribute("open", "");
    for (const fn of sources[0].listeners.changed ?? []) fn();
    await new Promise((r) => setTimeout(r, 20));
    const after = dom.window.document.querySelector("details.confirm")!;
    expect(after.hasAttribute("open")).toBe(true);
  });

  it("re-fetches the page it is on, not always the house page", async () => {
    const asked: string[] = [];
    new JSDOM(historyPage(house()), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          EventSource: class {
            static CLOSED = 2;
            readyState = 0;
            listeners: Record<string, (() => void)[]> = {};
            addEventListener(type: string, fn: () => void) {
              (this.listeners[type] ??= []).push(fn);
              if (type === "open") fn();
            }
          },
          fetch: async (url: string) => {
            asked.push(url);
            return { ok: false };
          },
        });
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual(["/h/ABC234/history"]);
  });
});
