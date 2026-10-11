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
    expect(historyOf(html)[0]).toContain("<img src=x onerror=alert(1)>");
  });

  it("lets only the payer delete a bill", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    await addBill(code, cookies.Rafi, "", { [ids.Dina]: "5" });
    const id = /name="bill" value="(\d+)"/.exec(await housePage(code, cookies.Rafi))?.[1] ?? "";
    expect((await post(`/h/${code}/delete`, cookies.Dina, { bill: id })).status).toBe(403);
    expect((await post(`/h/${code}/delete`, cookies.Rafi, { bill: id })).status).toBe(303);
    expect(balancesOf(await housePage(code, cookies.Dina))).toEqual([]);
    expect((await post(`/h/${code}/delete`, cookies.Rafi, { bill: id })).status).toBe(404);
  });
});

describe("payments", () => {
  async function owing() {
    const house = await setUpHouse("Rafi", "Dina");
    await addBill(house.code, house.cookies.Rafi, "", { [house.ids.Dina]: "15.50" });
    return house;
  }

  it("changes nothing until the receiver says they got it", async () => {
    const { code, cookies, ids } = await owing();
    expect((await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" })).status).toBe(303);
    expect(balancesOf(await housePage(code, cookies.Dina))).toEqual(["You owe Rafi $15.50"]);
    expect(textOf(await housePage(code, cookies.Dina))).toContain("You paid Rafi $15.50");

    const rafiPage = await housePage(code, cookies.Rafi);
    expect(textOf(rafiPage)).toContain("Dina says they paid you $15.50");
    expect((await press(rafiPage, "Got it", cookies.Rafi)).status).toBe(303);
    expect(textOf(await housePage(code, cookies.Dina))).toContain("Nobody owes anybody.");
    expect(historyOf(await housePage(code, cookies.Dina))[0]).toBe("Dina paid Rafi $15.50");
  });

  it("drops a payment the receiver says they didn't get", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    await press(await housePage(code, cookies.Rafi), "Didn't get it", cookies.Rafi);
    const dina = await housePage(code, cookies.Dina);
    expect(balancesOf(dina)).toEqual(["You owe Rafi $15.50"]);
    expect(historyOf(dina).some((line) => line.startsWith("Dina paid Rafi"))).toBe(false);
  });

  it("lets only the receiver answer, and only once, even when two answers race", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    const id = /name="payment" value="(\d+)"/.exec(await housePage(code, cookies.Rafi))?.[1] ?? "";
    expect((await post(`/h/${code}/answer`, cookies.Dina, { payment: id, answer: "received" })).status).toBe(403);

    const answers = await Promise.all([
      post(`/h/${code}/answer`, cookies.Rafi, { payment: id, answer: "received" }),
      post(`/h/${code}/answer`, cookies.Rafi, { payment: id, answer: "rejected" }),
    ]);
    expect(answers.map((r) => r.status).sort()).toEqual([303, 409]);
  });

  it("does not let another house answer or see a payment", async () => {
    const { code, cookies, ids } = await owing();
    await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "15.50" });
    const id = /name="payment" value="(\d+)"/.exec(await housePage(code, cookies.Rafi))?.[1] ?? "";
    const other = await newHouse();
    const zed = await joinAs(other, "Zed");
    expect((await post(`/h/${other}/answer`, zed, { payment: id, answer: "received" })).status).toBe(404);
    const forged = cookies.Rafi.replace(`person_${code}`, `person_${other}`);
    const res = await post(`/h/${other}/answer`, forged, { payment: id, answer: "received" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/h/${other}/join`);
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
