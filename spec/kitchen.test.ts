import { describe, expect, it } from "vitest";
import { buttonsOf, cookingListOf, joinAs, kitchen, newHouse, personIdOf, post, send, textOf } from "./helpers.ts";

async function house(...names: string[]) {
  const code = await newHouse();
  const cookies: Record<string, string> = {};
  for (const name of names) cookies[name] = await joinAs(code, name);
  return { code, cookies };
}

const cook = (code: string, cookie: string, action: string) => post(`/h/${code}/cook`, cookie, { action });
const mark = (code: string, cookie: string, state: string) => post(`/h/${code}/mark`, cookie, { state });

describe("cooking", () => {
  it("shows everyone in the house who is cooking, several at once", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    expect((await cook(code, cookies.Dani, "start")).status).toBe(303);
    expect(cookingListOf(await kitchen(code, cookies.Rafi))).toEqual(["Dani"]);

    await cook(code, cookies.Rafi, "start");
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual(["Dani", "Rafi"]);
    expect(buttonsOf(await kitchen(code, cookies.Dani))).toContain("I'm done");
  });

  it("does not list someone twice when they press start twice", async () => {
    const { code, cookies } = await house("Dani");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "start");
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual(["Dani"]);
  });

  it("asks clean or messy the moment you are done", async () => {
    const { code, cookies } = await house("Dani");
    await cook(code, cookies.Dani, "start");
    const done = await cook(code, cookies.Dani, "stop");
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/h/${code}/handoff`);

    const handoff = await send(`/h/${code}/handoff`, { cookie: cookies.Dani });
    expect(handoff.status).toBe(200);
    expect(buttonsOf(await handoff.text())).toEqual(["Left it clean", "Left it messy"]);
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual([]);
  });

  it("lets anyone in the house end a session someone forgot, without moving the blame", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    expect(buttonsOf(await kitchen(code, cookies.Rafi))).toContain("End Dani's session");

    const ended = await post(`/h/${code}/cook`, cookies.Rafi, { action: "end", person: await personIdOf(code, "Dani") });
    expect(ended.status).toBe(303);
    expect(ended.headers.get("location")).toBe(`/h/${code}`); // no handoff prompt for someone who didn't cook
    expect(cookingListOf(await kitchen(code, cookies.Dani))).toEqual([]);

    await mark(code, cookies.Rafi, "messy");
    expect(textOf(await kitchen(code, cookies.Rafi))).toContain("Left by Dani.");
  });

  it("answers an end with no usable person with a 400", async () => {
    const { code, cookies } = await house("Dani");
    expect((await post(`/h/${code}/cook`, cookies.Dani, { action: "end", person: "abc" })).status).toBe(400);
    expect((await post(`/h/${code}/cook`, cookies.Dani, { action: "end" })).status).toBe(400);
  });
});

describe("the handoff", () => {
  it("names the last cook while the kitchen is messy", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is messy");
    expect(text).toContain("Left by Dani.");
  });

  it("names nobody once it is clean, but still shows who cooked last", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await mark(code, cookies.Rafi, "clean"); // anyone in the house can say so

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is clean");
    expect(text).not.toContain("Left by");
    expect(text).toContain("Last cooked: Dani");
  });

  it("does not blame someone who starts cooking in an already messy kitchen", async () => {
    const { code, cookies } = await house("Dani", "Rafi");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await cook(code, cookies.Rafi, "start");

    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("Left by Dani.");
    expect(text).not.toContain("Left by Rafi");
    expect(text).toContain("Last cooked: Rafi");
  });

  it("keeps the blame where it was when someone marks messy again", async () => {
    const { code, cookies } = await house("Dani", "Rafi", "Sam");
    await cook(code, cookies.Dani, "start");
    await cook(code, cookies.Dani, "stop");
    await mark(code, cookies.Dani, "messy");
    await cook(code, cookies.Rafi, "start");
    await mark(code, cookies.Sam, "messy"); // a repeat of what is already true

    expect(textOf(await kitchen(code, cookies.Sam))).toContain("Left by Dani.");
  });

  it("is messy with nobody to name when nobody has cooked", async () => {
    const { code, cookies } = await house("Rafi");
    await mark(code, cookies.Rafi, "messy");
    const text = textOf(await kitchen(code, cookies.Rafi));
    expect(text).toContain("The kitchen is messy");
    expect(text).not.toContain("Left by");
  });

  it("offers only the mark button that changes something", async () => {
    const { code, cookies } = await house("Rafi");
    expect(buttonsOf(await kitchen(code, cookies.Rafi))).toContain("Mark messy");
    await mark(code, cookies.Rafi, "messy");
    const buttons = buttonsOf(await kitchen(code, cookies.Rafi));
    expect(buttons).toContain("Mark clean");
    expect(buttons).not.toContain("Mark messy");
  });
});

describe("what people type", () => {
  it("shows a cook's name as text, never as markup", async () => {
    const { code, cookies } = await house(`<b>x</b>`);
    await cook(code, cookies[`<b>x</b>`], "start");
    const html = await kitchen(code, cookies[`<b>x</b>`]);
    expect(html).not.toContain("<b>x</b>");
    expect(cookingListOf(html)).toEqual([`<b>x</b>`]);
  });
});

describe("bad input", () => {
  it("answers an unknown cook action, mark state or missing field with a 400", async () => {
    const { code, cookies } = await house("Dani");
    expect((await cook(code, cookies.Dani, "bogus")).status).toBe(400);
    expect((await mark(code, cookies.Dani, "bogus")).status).toBe(400);
    expect((await post(`/h/${code}/cook`, cookies.Dani, {})).status).toBe(400);
    expect((await post(`/h/${code}/mark`, cookies.Dani, {})).status).toBe(400);
    expect(textOf(await kitchen(code, cookies.Dani))).toContain("The kitchen is clean");
  });

  it("does nothing, and does not crash, for someone with no cookie", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/mark`, { form: { state: "messy" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
    expect(textOf(await kitchen(code, cookies.Dani))).toContain("The kitchen is clean");
  });

  it("refuses an oversized body with a 413 instead of hanging", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/join`, {
      cookie: cookies.Dani,
      body: `name=${"x".repeat(10_000)}`,
    });
    expect(res.status).toBe(413);
  });

  it("answers an unknown page inside a house with a 404", async () => {
    const { code, cookies } = await house("Dani");
    const res = await send(`/h/${code}/nonsense`, { cookie: cookies.Dani });
    expect(res.status).toBe(404);
  });
});
