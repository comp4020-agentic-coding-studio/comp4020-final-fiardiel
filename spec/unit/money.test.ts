import { describe, expect, it } from "vitest";
import { balancesFor, equalSplit, formatCents, parseCents, plainCents } from "../../src/money.ts";
import type { BillRecord, PaymentRecord } from "../../src/money.ts";

describe("parseCents", () => {
  it("reads plain dollar amounts as whole cents", () => {
    expect(parseCents("12")).toBe(1200);
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents(" $4.05 ")).toBe(405);
    expect(parseCents("0")).toBe(0);
  });

  it("refuses anything that isn't a plain amount", () => {
    for (const raw of ["", " ", "-5", "1.234", "abc", "1,000", "12.", ".5", "1e3", "NaN", "10000000"]) {
      expect(parseCents(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it("accepts up to a million dollars and no more", () => {
    expect(parseCents("1000000")).toBe(100_000_000);
    expect(parseCents("1000000.01")).toBeNull();
  });
});

describe("formatting", () => {
  it("shows dollars with two decimals", () => {
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(123450)).toBe("$1,234.50");
    expect(plainCents(334)).toBe("3.34");
    expect(plainCents(5)).toBe("0.05");
  });
});

describe("equalSplit", () => {
  it("gives the remainder to the payer when the payer is in it", () => {
    expect(equalSplit(1000, [1, 2, 3], 1)).toEqual([
      { personId: 1, cents: 334 },
      { personId: 2, cents: 333 },
      { personId: 3, cents: 333 },
    ]);
  });

  it("gives the remainder to the first person when the payer is not in it", () => {
    expect(equalSplit(101, [2, 3], 9)).toEqual([
      { personId: 2, cents: 51 },
      { personId: 3, cents: 50 },
    ]);
  });

  it("always adds up to the total exactly", () => {
    for (const total of [1, 2, 99, 100, 101, 1799, 100_000_000]) {
      for (const n of [1, 2, 3, 4, 7]) {
        const ids = Array.from({ length: n }, (_, i) => i + 1);
        const sum = equalSplit(total, ids, 1).reduce((s, x) => s + x.cents, 0);
        expect(sum, `${total} over ${n}`).toBe(total);
      }
    }
  });

  it("is empty for nobody", () => {
    expect(equalSplit(100, [], 1)).toEqual([]);
  });
});

describe("balancesFor", () => {
  const rafi = 1;
  const dina = 2;
  const ari = 3;
  // Rafi paid groceries: Rafi 20, Dina 20, Ari 20. Dina paid tissues: Dina 4.50, Rafi 4.50.
  const bills: BillRecord[] = [
    {
      id: 1,
      paidBy: rafi,
      note: "Groceries",
      shares: [
        { personId: rafi, cents: 2000 },
        { personId: dina, cents: 2000 },
        { personId: ari, cents: 2000 },
      ],
    },
    {
      id: 2,
      paidBy: dina,
      note: "Tissues",
      shares: [
        { personId: dina, cents: 450 },
        { personId: rafi, cents: 450 },
      ],
    },
  ];

  it("nets each pair, and only pairs who shared a bill", () => {
    expect(balancesFor(rafi, bills, [])).toEqual(new Map([[dina, 1550], [ari, 2000]]));
    expect(balancesFor(dina, bills, [])).toEqual(new Map([[rafi, -1550]]));
    expect(balancesFor(ari, bills, [])).toEqual(new Map([[rafi, -2000]]));
  });

  it("counts only received payments", () => {
    const pay = (status: PaymentRecord["status"]): PaymentRecord[] => [
      { id: 1, fromId: dina, toId: rafi, cents: 1550, status },
    ];
    expect(balancesFor(rafi, bills, pay("pending")).get(dina)).toBe(1550);
    expect(balancesFor(rafi, bills, pay("rejected")).get(dina)).toBe(1550);
    expect(balancesFor(rafi, bills, pay("received")).has(dina)).toBe(false);
    expect(balancesFor(dina, bills, pay("received")).has(rafi)).toBe(false);
  });

  it("flips direction when someone pays more than they owe", () => {
    const over: PaymentRecord[] = [{ id: 1, fromId: ari, toId: rafi, cents: 2500, status: "received" }];
    expect(balancesFor(rafi, bills, over).get(ari)).toBe(-500);
    expect(balancesFor(ari, bills, over).get(rafi)).toBe(500);
  });

  it("creates no debt from the payer's own share", () => {
    const solo: BillRecord[] = [{ id: 1, paidBy: rafi, note: "", shares: [{ personId: rafi, cents: 900 }] }];
    expect(balancesFor(rafi, solo, [])).toEqual(new Map());
  });
});
