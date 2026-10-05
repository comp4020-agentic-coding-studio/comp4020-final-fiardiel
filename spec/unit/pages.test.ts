import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { esc, handoffPage, homePage, joinPage, kitchenPage, layout } from "../../src/pages.ts";
import type { KitchenView } from "../../src/pages.ts";

const dani = { id: 1, name: "Dani" };
const rafi = { id: 2, name: "Rafi" };

const doc = (html: string) => new JSDOM(html).window.document;
const text = (html: string): string => doc(html).body.textContent ?? "";
const buttons = (html: string): string[] =>
  [...doc(html).querySelectorAll("button")].map((b) => b.textContent ?? "");

const view = (over: Partial<KitchenView> = {}): KitchenView => ({
  code: "ABC234",
  me: rafi,
  cooking: [],
  state: "clean",
  responsible: null,
  lastCooked: null,
  iAmCooking: false,
  ...over,
});

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

describe("kitchen page", () => {
  it("shows names as text, never as markup", () => {
    const html = kitchenPage(view({ cooking: [{ id: 3, name: "<img src=x onerror=alert(1)>" }] }));
    expect(doc(html).querySelector("img")).toBeNull();
    expect(text(html)).toContain("<img src=x onerror=alert(1)>");
  });

  it("says who is cooking now, or that nobody is", () => {
    expect(text(kitchenPage(view()))).toContain("Nobody right now.");
    const html = kitchenPage(view({ cooking: [dani, rafi] }));
    expect([...doc(html).querySelectorAll("li .name")].map((n) => n.textContent)).toEqual(["Dani", "Rafi"]);
  });

  it("lets you end someone else's session from the list, but not your own", () => {
    const html = kitchenPage(view({ me: rafi, cooking: [dani, rafi], iAmCooking: true }));
    expect(buttons(html)).toEqual(["End Dani's session", "I'm done", "Mark messy"]);
  });

  it("names the responsible person only while the kitchen is messy", () => {
    const messy = text(kitchenPage(view({ state: "messy", responsible: dani })));
    expect(messy).toContain("The kitchen is messy");
    expect(messy).toContain("Left by Dani.");

    const clean = text(kitchenPage(view({ state: "clean", responsible: dani })));
    expect(clean).toContain("The kitchen is clean");
    expect(clean).not.toContain("Left by");
  });

  it("always shows who cooked last as a plain fact", () => {
    expect(text(kitchenPage(view({ state: "clean", lastCooked: dani })))).toContain("Last cooked: Dani");
    expect(text(kitchenPage(view({ state: "messy", responsible: dani, lastCooked: rafi })))).toContain(
      "Last cooked: Rafi",
    );
    expect(text(kitchenPage(view()))).not.toContain("Last cooked");
  });

  it("offers only the buttons that change something", () => {
    expect(buttons(kitchenPage(view({ iAmCooking: false, state: "clean" })))).toEqual(["I'm cooking", "Mark messy"]);
    expect(buttons(kitchenPage(view({ iAmCooking: true, state: "messy" })))).toEqual(["I'm done", "Mark clean"]);
  });
});

describe("handoff page", () => {
  it("asks whether the kitchen was left clean or messy, and can be skipped", () => {
    const html = handoffPage("ABC234");
    expect(text(html)).toContain("Left the kitchen clean or messy?");
    expect(buttons(html)).toEqual(["Left it clean", "Left it messy"]);
    expect(doc(html).querySelector('a[href="/h/ABC234"]')?.textContent).toBe("Skip");
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

  it("has no claim list for an empty house", () => {
    expect(buttons(joinPage("ABC234", []))).toEqual(["Join"]);
  });
});

describe("home page", () => {
  it("offers to start or join a house", () => {
    expect(buttons(homePage())).toEqual(["Start a new house", "Join"]);
  });

  it("shows a message when given one", () => {
    expect(text(homePage("No such house"))).toContain("No such house");
  });
});
