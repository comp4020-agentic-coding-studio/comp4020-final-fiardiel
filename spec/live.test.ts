import { describe, expect, it } from "vitest";
import { addBill, housePage, joinAs, newHouse, openEvents, post, setUpHouse } from "./helpers.ts";

const CHANGED = "event: changed";

describe("live updates", () => {
  it("opens an event stream for someone in the house", async () => {
    const { code, cookies } = await setUpHouse("Rafi");
    const events = await openEvents(code, cookies.Rafi);
    try {
      expect(events.status).toBe(200);
      expect(events.type).toMatch(/^text\/event-stream/);
      expect(await events.waitFor(": connected", 1000)).toBe(true);
    } finally {
      events.close();
    }
  });

  it("refuses the stream to a stranger and to someone from another house", async () => {
    const { code } = await setUpHouse("Rafi");
    const other = await newHouse();
    const zed = await joinAs(other, "Zed");
    for (const cookie of [undefined, zed.replace(`person_${other}`, `person_${code}`)]) {
      const events = await openEvents(code, cookie);
      events.close();
      expect(events.status, String(cookie)).toBe(403);
    }
  });

  it("tells everyone else in the house within a second when a bill is added", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    const dina = await openEvents(code, cookies.Dina);
    try {
      expect(await dina.waitFor(": connected", 1000)).toBe(true);
      await addBill(code, cookies.Rafi, "Groceries", { [ids.Dina]: "20" });
      expect(await dina.waitFor(CHANGED, 1000)).toBe(true);
    } finally {
      dina.close();
    }
  });

  it("tells the house when a payment is made and when it is answered", async () => {
    const { code, cookies, ids } = await setUpHouse("Rafi", "Dina");
    const dina = await openEvents(code, cookies.Dina);
    try {
      expect(await dina.waitFor(": connected", 1000)).toBe(true);
      await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "5" });
      expect(await dina.waitFor(CHANGED, 1000)).toBe(true);
      const page = await housePage(code, cookies.Rafi);
      const id = /name="payment" value="(\d+)"/.exec(page)?.[1] ?? "";
      await post(`/h/${code}/answer`, cookies.Rafi, { payment: id, answer: "received" });
      expect(await dina.waitFor(CHANGED, 1000)).toBe(true);
    } finally {
      dina.close();
    }
  });

  it("tells no other house", async () => {
    const a = await setUpHouse("Rafi");
    const b = await setUpHouse("Zed");
    const zed = await openEvents(b.code, b.cookies.Zed);
    try {
      expect(await zed.waitFor(": connected", 1000)).toBe(true);
      await addBill(a.code, a.cookies.Rafi, "", { [a.ids.Rafi]: "1" });
      expect(await zed.waitFor(CHANGED, 500)).toBe(false);
    } finally {
      zed.close();
    }
  });
});
