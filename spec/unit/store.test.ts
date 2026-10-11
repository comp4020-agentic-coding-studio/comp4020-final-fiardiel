import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../../src/store.ts";

const open: Store[] = [];
const memory = (): Store => {
  const store = new Store(":memory:");
  open.push(store);
  return store;
};
afterEach(() => {
  while (open.length > 0) open.pop()!.close();
});

function joinOk(store: Store, code: string, name: string) {
  const outcome = store.join(code, name);
  if (!outcome.ok) throw new Error(`join failed: ${outcome.reason}`);
  return outcome;
}

describe("houses", () => {
  it("creates houses with six-character codes that avoid look-alike characters", () => {
    const store = memory();
    const code = store.createHouse();
    expect(code).toMatch(/^[23456789A-HJ-NP-Z]{6}$/);
    expect(store.houseExists(code)).toBe(true);
    expect(store.houseExists("ZZZZZZ")).toBe(false);
  });
});

describe("joining", () => {
  it("stores the normalised name", () => {
    const store = memory();
    const code = store.createHouse();
    expect(joinOk(store, code, "  Dani   B  ").person.name).toBe("Dani B");
  });

  it("rejects bad names", () => {
    const store = memory();
    const code = store.createHouse();
    for (const name of ["", "   ", "x".repeat(25), "bad\u0007name"]) {
      expect(store.join(code, name), JSON.stringify(name)).toEqual({ ok: false, reason: "invalid_name" });
    }
  });

  it("treats a name as taken whatever its case, within one house only", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    joinOk(store, a, "Dani");
    expect(store.join(a, "dani")).toEqual({ ok: false, reason: "name_taken" });
    expect(store.join(b, "dani").ok).toBe(true);
  });

  it("treats look-alike names as taken: invisible characters and accent forms", () => {
    const store = memory();
    const code = store.createHouse();
    joinOk(store, code, "Dani");
    expect(store.join(code, "Dani\u00ad")).toEqual({ ok: false, reason: "name_taken" });
    joinOk(store, code, "Am\u00e9");
    expect(store.join(code, "Ame\u0301")).toEqual({ ok: false, reason: "name_taken" });
  });

  it("rejects a name that is only an invisible character", () => {
    const store = memory();
    const code = store.createHouse();
    expect(store.join(code, "\u200b")).toEqual({ ok: false, reason: "invalid_name" });
  });

  it("reports an unknown house", () => {
    expect(memory().join("ZZZZZZ", "Dani")).toEqual({ ok: false, reason: "no_house" });
  });
});

describe("identity", () => {
  it("finds a person by token, only inside their own house", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.personByToken(a, dani.token)).toEqual(dani.person);
    expect(store.personByToken(b, dani.token)).toBeNull();
    expect(store.personByToken(a, "nonsense")).toBeNull();
    expect(store.personByToken(a, "")).toBeNull();
  });

  it("lets someone claim an existing name, only within its house", () => {
    const store = memory();
    const a = store.createHouse();
    const b = store.createHouse();
    const dani = joinOk(store, a, "Dani");
    expect(store.claim(a, dani.person.id)).toEqual({ person: dani.person, token: dani.token });
    expect(store.claim(b, dani.person.id)).toBeNull();
    expect(store.claim(a, 9999)).toBeNull();
  });

  it("lists the people in a house by name", () => {
    const store = memory();
    const code = store.createHouse();
    joinOk(store, code, "Rafi");
    joinOk(store, code, "Dani");
    expect(store.people(code).map((p) => p.name)).toEqual(["Dani", "Rafi"]);
  });
});

function house(store: Store, ...names: string[]) {
  const code = store.createHouse();
  const ids = names.map((n) => joinOk(store, code, n).person.id);
  return { code, ids };
}

describe("bills", () => {
  it("stores a bill with its shares, newest first, leaving zero shares out", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina, ari],
    } = house(store, "Rafi", "Dina", "Ari");
    const first = store.addBill(code, rafi, "Groceries", [
      { personId: rafi, cents: 450 },
      { personId: dina, cents: 450 },
      { personId: ari, cents: 900 },
    ]);
    const second = store.addBill(code, dina, "", [
      { personId: rafi, cents: 100 },
      { personId: ari, cents: 0 },
    ]);
    expect(first).not.toBeNull();
    const bills = store.bills(code);
    expect(bills.map((b) => b.id)).toEqual([second, first]);
    expect(bills[1]).toMatchObject({ paidBy: rafi, note: "Groceries" });
    expect(bills[1].shares).toEqual([
      { personId: rafi, cents: 450 },
      { personId: dina, cents: 450 },
      { personId: ari, cents: 900 },
    ]);
    expect(bills[0].shares).toEqual([{ personId: rafi, cents: 100 }]);
  });

  it("refuses a bill with nobody in it, a person from another house, or a payer from another house", () => {
    const store = memory();
    const {
      code,
      ids: [rafi],
    } = house(store, "Rafi");
    const zed = house(store, "Zed").ids[0];
    expect(store.addBill(code, rafi, "", [])).toBeNull();
    expect(store.addBill(code, rafi, "", [{ personId: rafi, cents: 0 }])).toBeNull();
    expect(store.addBill(code, rafi, "", [{ personId: zed, cents: 100 }])).toBeNull();
    expect(store.addBill(code, zed, "", [{ personId: rafi, cents: 100 }])).toBeNull();
    expect(
      store.addBill(code, rafi, "", [
        { personId: rafi, cents: 100 },
        { personId: rafi, cents: 100 },
      ]),
    ).toBeNull();
    expect(store.bills(code)).toEqual([]);
  });

  it("lets only the payer delete a bill, once, inside its house", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina],
    } = house(store, "Rafi", "Dina");
    const other = house(store, "Zed");
    const id = store.addBill(code, rafi, "", [{ personId: dina, cents: 100 }])!;
    expect(store.deleteBill(code, id, dina)).toBe("not_yours");
    expect(store.deleteBill(other.code, id, other.ids[0])).toBe("gone");
    expect(store.deleteBill(code, id, rafi)).toBe("deleted");
    expect(store.deleteBill(code, id, rafi)).toBe("gone");
    expect(store.bills(code)).toEqual([]);
  });

  it("keeps each house's bills apart", () => {
    const store = memory();
    const a = house(store, "Rafi");
    const b = house(store, "Dina");
    store.addBill(b.code, b.ids[0], "", [{ personId: b.ids[0], cents: 100 }]);
    expect(store.bills(a.code)).toEqual([]);
    expect(store.bills(b.code)).toHaveLength(1);
  });
});

describe("payments", () => {
  it("records a payment as pending, between two people in the house", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina],
    } = house(store, "Rafi", "Dina");
    const id = store.recordPayment(code, dina, rafi, 1550);
    expect(store.payments(code)).toMatchObject([{ id, fromId: dina, toId: rafi, cents: 1550, status: "pending" }]);
  });

  it("refuses paying yourself, nobody, an outsider, or an amount out of range", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina],
    } = house(store, "Rafi", "Dina");
    const zed = house(store, "Zed").ids[0];
    expect(store.recordPayment(code, rafi, rafi, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, zed, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, 9999, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, dina, 0)).toBeNull();
    expect(store.recordPayment(code, rafi, dina, 100_000_001)).toBeNull();
    expect(store.payments(code)).toEqual([]);
  });

  it("lets only the receiver answer, only once", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina],
    } = house(store, "Rafi", "Dina");
    const id = store.recordPayment(code, dina, rafi, 100)!;
    expect(store.answerPayment(code, id, dina, "received")).toBe("not_yours");
    expect(store.answerPayment(code, id, rafi, "received")).toBe("done");
    expect(store.answerPayment(code, id, rafi, "rejected")).toBe("already");
    expect(store.payments(code)[0].status).toBe("received");
    expect(store.answerPayment(code, 9999, rafi, "received")).toBe("gone");
  });

  it("does not let another house answer a payment", () => {
    const store = memory();
    const {
      code,
      ids: [rafi, dina],
    } = house(store, "Rafi", "Dina");
    const other = house(store, "Zed");
    const id = store.recordPayment(code, dina, rafi, 100)!;
    expect(store.answerPayment(other.code, id, other.ids[0], "received")).toBe("gone");
    expect(store.payments(code)[0].status).toBe("pending");
  });
});

describe("persistence", () => {
  it("keeps houses, people, bills and payments across a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "serumah-"));
    const path = join(dir, "nested", "kitchen.db");
    try {
      const first = new Store(path);
      const code = first.createHouse();
      const rafi = joinOk(first, code, "Rafi");
      const dina = joinOk(first, code, "Dina");
      first.addBill(code, rafi.person.id, "Groceries", [{ personId: dina.person.id, cents: 2000 }]);
      const paid = first.recordPayment(code, dina.person.id, rafi.person.id, 2000)!;
      first.answerPayment(code, paid, rafi.person.id, "received");
      first.close();

      const second = new Store(path);
      expect(second.personByToken(code, dina.token)).toEqual(dina.person);
      expect(second.bills(code).map((b) => b.note)).toEqual(["Groceries"]);
      expect(second.payments(code).map((p) => p.status)).toEqual(["received"]);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
