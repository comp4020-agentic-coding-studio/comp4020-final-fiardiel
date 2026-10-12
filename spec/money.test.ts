import { describe, expect, it } from "vitest";
import { addBill, balancesOf, historyOf, housePage, joinAs, newHouse, post, press, send, setUpHouse, textOf } from "./helpers.ts";

describe("bills", () => {
  it("puts the amounts the payer typed on each person", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina", "Ari");
    const res = await addBill(code, cookies.Rafi, "Tissues", { [ids.Rafi]: "4.50", [ids.Dina]: "$4.50", [ids.Ari]: " 9 " });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}`);
    expect(balancesOf(await housePage(code, cookies.Rafi))).toEqual(["Ari owes you $9.00", "Dina owes you $4.50"]);
    expect(balancesOf(await housePage(code, cookies.Dina))).toEqual(["You owe Rafi $4.50"]);
  });

  it("lists balances in name order, not by who owes most", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina", "Ari");
    await addBill(code, cookies.Rafi, "", { [ids.Ari]: "1", [ids.Dina]: "9" });
    expect(balancesOf(await housePage(code, cookies.Rafi))).toEqual(["Ari owes you $1.00", "Dina owes you $9.00"]);
  });

  it("splits a total equally into the boxes, saving nothing until the payer adds it", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina", "Ari");
    const res = await post(`/h/${code}/bill`, cookies.Rafi, {
      note: "Groceries",
      intent: "fill",
      total: "10",
      [`with_${ids.Rafi}`]: "on",
      [`with_${ids.Dina}`]: "on",
      [`with_${ids.Ari}`]: "on",
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    const value = (id: string) => new RegExp(`name="amount_${id}"[^>]*value="([^"]*)"`).exec(html)?.[1];
    expect([value(ids.Rafi), value(ids.Dina), value(ids.Ari)]).toEqual(["3.34", "3.33", "3.33"]);
    expect(historyOf(await housePage(code, cookies.Rafi))).toEqual([]);
  });

  it("refuses amounts that aren't dollars, and a bill with nobody in it, keeping what was typed", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    for (const amount of ["abc", "-5", "1.234", "1,000"]) {
      const res = await addBill(code, cookies.Rafi, "Woolies", { [ids.Dina]: amount });
      expect(res.status, amount).toBe(400);
      const html = await res.text();
      expect(textOf(html), amount).toContain("Dina's amount");
      expect(html, amount).toContain('value="Woolies"');
    }
    const empty = await addBill(code, cookies.Rafi, "Woolies", { [ids.Dina]: "0" });
    expect(empty.status).toBe(400);
    expect(textOf(await empty.text())).toContain("at least one person");
    expect(historyOf(await housePage(code, cookies.Rafi))).toEqual([]);
  });

  it("refuses a note that is too long", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi");
    const res = await addBill(code, cookies.Rafi, "x".repeat(81), { [ids.Rafi]: "1" });
    expect(res.status).toBe(400);
  });

  it("shows a note containing markup as text", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    await addBill(code, cookies.Rafi, "<img src=x onerror=alert(1)>", { [ids.Dina]: "1" });
    const html = await housePage(code, cookies.Dina);
    expect(html).not.toContain("<img src=x");
    expect(historyOf(html)[0].what).toBe("<img src=x onerror=alert(1)>");
  });

  it("lets only the payer delete a bill", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    await addBill(code, cookies.Rafi, "", { [ids.Dina]: "5" });
    const id = /name="bill" value="(\d+)"/.exec(await housePage(code, cookies.Rafi))?.[1] ?? "";
    expect((await post(`/h/${code}/delete`, cookies.Dina, { bill: id })).status).toBe(403);
    expect((await press(await housePage(code, cookies.Rafi), "Yes, delete", cookies.Rafi)).status).toBe(303);
    expect(balancesOf(await housePage(code, cookies.Dina))).toEqual([]);
    const again = await post(`/h/${code}/delete`, cookies.Rafi, { bill: id });
    expect(again.status).toBe(404);
    const html = await again.text();
    expect(textOf(html)).toContain("isn't here any more");
    expect(textOf(html)).toContain("Nobody owes anybody.");
  });
});

describe("payments", () => {
  async function owing() {
    const house = await setUpHouse("Rafi", "Dina");
    await addBill(house.code, house.cookies.Rafi, "", { [house.ids.Dina]: "15.50" });
    return house;
  }
  const paymentId = (html: string): string => /action="\/h\/[A-Z0-9]+\/dispute"[\s\S]*?name="payment" value="(\d+)"/.exec(html)?.[1] ?? "";

  it("counts a payment as soon as it is recorded, for both people", async () => {
    const { code, cookies, ids } = await owing();
    expect((await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" })).status).toBe(303);
    expect(textOf(await housePage(code, cookies.Dina))).toContain("Nobody owes anybody.");
    expect(textOf(await housePage(code, cookies.Rafi))).toContain("Nobody owes anybody.");
    expect(historyOf(await housePage(code, cookies.Dina))[0]).toMatchObject({ pill: "Paid", what: "You paid Rafi", total: "$15.50" });
  });

  it("brings the debt back when the receiver says the money never arrived", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    const rafiPage = await housePage(code, cookies.Rafi);
    expect(historyOf(rafiPage)[0]).toMatchObject({ what: "Dina paid you", total: "$15.50" });
    expect((await press(rafiPage, "Didn't get it", cookies.Rafi)).status).toBe(303);
    const dina = await housePage(code, cookies.Dina);
    expect(balancesOf(dina)).toEqual(["You owe Rafi $15.50"]);
    expect(historyOf(dina).some((e) => e.pill === "Paid")).toBe(false);
  });

  it("lets only the receiver dispute, and only once, even when two taps race", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    const id = paymentId(await housePage(code, cookies.Rafi));
    expect(id).not.toBe("");
    expect(paymentId(await housePage(code, cookies.Dina))).toBe("");
    expect((await post(`/h/${code}/dispute`, cookies.Dina, { payment: id })).status).toBe(403);

    const taps = await Promise.all([
      post(`/h/${code}/dispute`, cookies.Rafi, { payment: id }),
      post(`/h/${code}/dispute`, cookies.Rafi, { payment: id }),
    ]);
    expect(taps.map((r) => r.status).sort()).toEqual([303, 409]);
    // The slower tap changed nothing, but the person is shown how things now stand.
    const late = await taps.find((r) => r.status === 409)!.text();
    expect(textOf(late)).toContain("already removed");
    expect(balancesOf(late)).toEqual(["Dina owes you $15.50"]);
  });

  it("does not let another house dispute a payment", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    const id = paymentId(await housePage(code, cookies.Rafi));
    const other = await newHouse();
    const zed = await joinAs(other, "Zed");
    expect((await post(`/h/${other}/dispute`, zed, { payment: id })).status).toBe(404);
    const forged = cookies.Rafi.replace(`person_${code}`, `person_${other}`);
    const res = await post(`/h/${other}/dispute`, forged, { payment: id });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${other}/join`);
    expect(textOf(await housePage(code, cookies.Rafi))).toContain("Nobody owes anybody.");
  });

  it("refuses paying yourself, someone outside the house, or a bad amount", async () => {
    const { code, cookies, ids } = await owing();
    for (const form of [
      { to: ids.Dina, amount: "5" },
      { to: "9999999", amount: "5" },
      { to: "abc", amount: "5" },
      { to: ids.Rafi, amount: "0" },
      { to: ids.Rafi, amount: "lots" },
    ]) {
      expect((await post(`/h/${code}/pay`, cookies.Dina, form)).status, JSON.stringify(form)).toBe(400);
    }
  });
});

describe("history", () => {
  it("shows each person only the bills and payments that involve them", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina", "Ari");
    await addBill(code, cookies.Dina, "Boba", { [ids.Ari]: "8", [ids.Dina]: "8" });
    await post(`/h/${code}/pay`, cookies.Ari, { to: ids.Dina, amount: "8" });
    await addBill(code, cookies.Rafi, "Coles", { [ids.Dina]: "10" });

    expect(historyOf(await housePage(code, cookies.Rafi)).map((e) => e.what)).toEqual(["Coles"]);
    expect(historyOf(await housePage(code, cookies.Ari)).map((e) => e.what)).toEqual(["You paid Dina", "Boba"]);
    expect(historyOf(await housePage(code, cookies.Dina)).map((e) => e.what)).toEqual(["Coles", "Ari paid you", "Boba"]);
  });
});

describe("pages of their own", () => {
  it("opens adding a bill, recording a payment and the full history from the house page", async () => {
    const { code, cookies } = await setUpHouse("Rafi", "Dina");
    const html = await housePage(code, cookies.Rafi);
    expect(html).toContain(`href="/h/${code}/bill"`);
    expect(html).toContain(`href="/h/${code}/pay"`);
    expect(html).not.toContain(`action="/h/${code}/bill"`);
    for (const page of ["bill", "pay", "history"]) {
      const res = await send(`/h/${code}/${page}`, { cookie: cookies.Rafi });
      expect(res.status, page).toBe(200);
      expect(await res.text(), page).toContain(`href="/h/${code}">← Back`);
    }
    expect(await (await send(`/h/${code}/bill`, { cookie: cookies.Rafi })).text()).toContain(`action="/h/${code}/bill"`);
    expect(await (await send(`/h/${code}/pay`, { cookie: cookies.Rafi })).text()).toContain(`action="/h/${code}/pay"`);
  });

  it("sends a stranger to join instead of showing the forms or history", async () => {
    const { code } = await setUpHouse("Rafi");
    for (const page of ["bill", "pay", "history"]) {
      const res = await send(`/h/${code}/${page}`);
      expect(res.status, page).toBe(303);
      expect(res.headers.get("location"), page).toBe(`/h/${code}/join`);
    }
  });

  it("keeps a mistyped bill on the bill page", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    const res = await addBill(code, cookies.Rafi, "Woolies", { [ids.Dina]: "abc" });
    const html = await res.text();
    expect(html).toContain(`action="/h/${code}/bill"`);
    expect(html).not.toContain(`action="/h/${code}/pay"`);
  });

  it("keeps a mistyped payment on the payment page, with what was typed", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    const res = await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "lots" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain(`action="/h/${code}/pay"`);
    expect(html).toContain('value="lots"');
    expect(html).toMatch(new RegExp(`value="${ids.Rafi}" selected`));
    expect(textOf(html)).toContain("Type the amount in dollars");
  });

  it("shows the 5 most recent entries on the house page and every one on the history page", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    for (let i = 1; i <= 7; i++) await addBill(code, cookies.Rafi, `Bill ${i}`, { [ids.Dina]: "1" });
    const house = await housePage(code, cookies.Dina);
    expect(historyOf(house).map((e) => e.what)).toEqual(["Bill 7", "Bill 6", "Bill 5", "Bill 4", "Bill 3"]);
    expect(textOf(house)).toContain("See all history (7)");
    const all = await (await send(`/h/${code}/history`, { cookie: cookies.Dina })).text();
    expect(historyOf(all)).toHaveLength(7);
  });
});

describe("tone", () => {
  it("never nags, even when someone owes and a payment waits", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    await addBill(code, cookies.Rafi, "Groceries", { [ids.Dina]: "20" });
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "5" });
    for (const who of ["Rafi", "Dina"]) {
      expect(textOf(await housePage(code, cookies[who])), who).not.toMatch(/\b(overdue|late|remind|reminder|urgent)\b/i);
    }
  });
});

describe("the page without a cookie", () => {
  it("sends a stranger to join instead of acting", async () => {
    const { code, ids } = await setUpHouse("Rafi");
    const res = await send(`/h/${code}/pay`, { form: { to: ids.Rafi, amount: "5" } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${code}/join`);
  });
});
