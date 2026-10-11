# Serumah (Crit 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kitchen with Serumah's money slice — bills with amounts the payer sets, payments the receiver confirms, pairwise balances — and make every change reach every open page in the house within a second.

**Architecture:** Pure money rules in `src/money.ts`; storage in `src/store.ts` (kitchen tables dropped, `bills`, `bill_shares`, `payments` added); a per-house server-sent-events hub in `src/live.ts`; server-rendered pages in `src/pages.ts` with a small inline script that re-fetches the page and swaps in the `#live` section when told something changed; routes in `src/app.ts`.

**Tech Stack:** Node 24 running TypeScript directly (erasable syntax only, `.ts` imports), built-in `node:sqlite`, `node:http`, vitest + jsdom for checks. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-serumah-design.md`

## Global Constraints

- Node 24, TypeScript run directly: erasable syntax only (no `enum`, no `namespace`, no constructor parameter properties), imports end in `.ts`.
- No new dependency.
- Amounts are integer cents everywhere; shown as dollars with two decimals.
- Everything another person typed (names, notes, messages that contain them) goes through `esc()` before reaching a page.
- Every store read and write is scoped by house code; a cookie works only in its own house.
- No reminders, notifications, "overdue", rankings of who owes most, or emphasis on debts. Balances are listed in name order.
- Only `received` payments count. Only the receiver answers a payment, only while `pending`. Only the payer deletes a bill.
- `README.md`, `PROCESS.md` and `reflections/` are the author's writing: do not edit them.
- The repo is public and CI deploys every push to `main`. All work happens on branch `serumah`; nothing is pushed to `main` without the author's go-ahead (Task 9).
- Checks in `spec/*.test.ts` run against the RUNNING app (`APP_URL`, default `http://localhost:8080`). Restart the app after each code change before running them. Unit checks in `spec/unit/` run with `pnpm test:unit` and need no app.

## Review Focus

- A live update arriving while someone is typing a bill must not wipe the form → forms sit outside `#live` (pinned in Task 5).
- A stream silently dropped by Fly's proxy after idling → heartbeat every 25 s, and the page re-fetches on every reconnect (pinned in Task 4 and Task 5).
- A double tap on "Got it", or two devices answering at once → exactly one change, the other told it was already answered (pinned in Task 7).
- Amounts typed the way people type them (`$4.50`, ` 12 `, `12.5`) are accepted; `1,000`, `-5`, `1.234` get a clear message, not a crash or a wrong number (pinned in Task 1 and Task 7).
- A note or name containing markup in the history, in balances, and in an error message → shown as text (pinned in Task 5 and Task 7).

## File map

- Create `src/money.ts` — parse/format cents, equal split, pairwise balances (pure).
- Modify `src/names.ts` — add `normaliseNote`, `NOTE_MAX`.
- Modify `src/store.ts` — drop kitchen, add bills and payments.
- Create `src/live.ts` — `Hub`: event streams per house.
- Modify `src/pages.ts` — `housePage`, live script; remove kitchen and handoff pages.
- Modify `src/app.ts` — money routes and the events route; remove kitchen routes.
- Modify `src/main.ts` — create the hub, close streams on shutdown.
- Delete `src/rules.ts`, `spec/unit/rules.test.ts`, `spec/kitchen.test.ts`.
- Create `spec/unit/money.test.ts`, `spec/unit/live.test.ts`, `spec/money.test.ts`, `spec/live.test.ts`.
- Modify `spec/unit/names.test.ts`, `spec/unit/store.test.ts`, `spec/unit/pages.test.ts`, `spec/helpers.ts`, `spec/houses.test.ts`.
- Modify `CLAUDE.md` — the rules from spec section 6.

---

### Task 0: Branch

- [ ] **Step 1: Create the branch**

```bash
git switch -c serumah
```

---

### Task 1: Money rules

**Files:**
- Create: `src/money.ts`
- Test: `spec/unit/money.test.ts`

**Interfaces:**
- Produces:
  - `MAX_CENTS: number` (100_000_000)
  - `parseCents(raw: string): number | null`
  - `formatCents(cents: number): string` — `"$1,234.50"`
  - `plainCents(cents: number): string` — `"3.34"` (for refilling inputs)
  - `type Share = { personId: number; cents: number }`
  - `equalSplit(totalCents: number, ids: number[], payerId: number): Share[]`
  - `type PaymentStatus = "pending" | "received" | "rejected"`
  - `type BillRecord = { id: number; paidBy: number; note: string; shares: Share[] }`
  - `type PaymentRecord = { id: number; fromId: number; toId: number; cents: number; status: PaymentStatus }`
  - `balancesFor(me: number, bills: BillRecord[], payments: PaymentRecord[]): Map<number, number>` — positive: they owe me; negative: I owe them; zero entries removed.

- [ ] **Step 1: Write the failing test**

`spec/unit/money.test.ts`:

```ts
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
    { id: 1, paidBy: rafi, note: "Groceries", shares: [{ personId: rafi, cents: 2000 }, { personId: dina, cents: 2000 }, { personId: ari, cents: 2000 }] },
    { id: 2, paidBy: dina, note: "Tissues", shares: [{ personId: dina, cents: 450 }, { personId: rafi, cents: 450 }] },
  ];

  it("nets each pair, and only pairs who shared a bill", () => {
    expect(balancesFor(rafi, bills, [])).toEqual(new Map([[dina, 1550], [ari, 2000]]));
    expect(balancesFor(dina, bills, [])).toEqual(new Map([[rafi, -1550]]));
    expect(balancesFor(ari, bills, [])).toEqual(new Map([[rafi, -2000]]));
  });

  it("counts only received payments", () => {
    const pay = (status: PaymentRecord["status"]): PaymentRecord[] => [{ id: 1, fromId: dina, toId: rafi, cents: 1550, status }];
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:unit spec/unit/money.test.ts`
Expected: FAIL, cannot find module `../../src/money.ts`.

- [ ] **Step 3: Implement**

`src/money.ts`:

```ts
// Money is whole cents everywhere: stored, added and compared. Dollars only
// appear at the edges, when someone types an amount or reads one.

export const MAX_CENTS = 100_000_000; // $1,000,000.00

export type Share = { personId: number; cents: number };
export type PaymentStatus = "pending" | "received" | "rejected";
export type BillRecord = { id: number; paidBy: number; note: string; shares: Share[] };
export type PaymentRecord = { id: number; fromId: number; toId: number; cents: number; status: PaymentStatus };

// "12", "12.5", " $4.05 " → cents. Null for anything else, including
// negatives, thousands separators and more than two decimals.
export function parseCents(raw: string): number | null {
  const match = raw.trim().replace(/^\$/, "").match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (match === null) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return cents <= MAX_CENTS ? cents : null;
}

const DOLLARS = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatCents(cents: number): string {
  return DOLLARS.format(cents / 100);
}

// The same amount as a person would type it back into a box.
export function plainCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// Equal shares in cents. The cents that don't divide evenly go to the payer if
// they are in the split, otherwise to the first person, so the shares always
// add up to the total exactly.
export function equalSplit(totalCents: number, ids: number[], payerId: number): Share[] {
  if (ids.length === 0) return [];
  const base = Math.floor(totalCents / ids.length);
  const remainder = totalCents - base * ids.length;
  const gets = ids.includes(payerId) ? payerId : ids[0];
  return ids.map((personId) => ({ personId, cents: base + (personId === gets ? remainder : 0) }));
}

// What each other person owes `me`, pair by pair: positive means they owe me,
// negative means I owe them. Only received payments count. Derived from the
// record every time, never stored.
export function balancesFor(me: number, bills: BillRecord[], payments: PaymentRecord[]): Map<number, number> {
  const net = new Map<number, number>();
  const add = (other: number, cents: number): void => {
    net.set(other, (net.get(other) ?? 0) + cents);
  };
  for (const bill of bills) {
    for (const share of bill.shares) {
      if (share.personId === bill.paidBy) continue;
      if (bill.paidBy === me) add(share.personId, share.cents);
      else if (share.personId === me) add(bill.paidBy, -share.cents);
    }
  }
  for (const payment of payments) {
    if (payment.status !== "received") continue;
    if (payment.toId === me) add(payment.fromId, -payment.cents);
    else if (payment.fromId === me) add(payment.toId, payment.cents);
  }
  for (const [other, cents] of net) if (cents === 0) net.delete(other);
  return net;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm test:unit spec/unit/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/money.ts spec/unit/money.test.ts
git commit -m "feat: add the money rules: cents, equal split, pairwise balances"
```

---

### Task 2: Notes on bills

**Files:**
- Modify: `src/names.ts`
- Test: `spec/unit/names.test.ts`

**Interfaces:**
- Produces: `NOTE_MAX: number` (80), `normaliseNote(raw: string): string | null` — trimmed, single-spaced, NFC; empty allowed; null when too long or holding control/bidi characters.

- [ ] **Step 1: Write the failing test**

Append to `spec/unit/names.test.ts` (and add `normaliseNote` to its import from `../../src/names.ts`):

```ts
describe("normaliseNote", () => {
  it("trims and collapses spaces, and allows an empty note", () => {
    expect(normaliseNote("  Woolies   Sat ")).toBe("Woolies Sat");
    expect(normaliseNote("   ")).toBe("");
  });

  it("refuses notes that are too long or hold control characters", () => {
    expect(normaliseNote("x".repeat(80))).toBe("x".repeat(80));
    expect(normaliseNote("x".repeat(81))).toBeNull();
    expect(normaliseNote("bad\u0007note")).toBeNull();
    expect(normaliseNote("evil‮etirw")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:unit spec/unit/names.test.ts`
Expected: FAIL, `normaliseNote` is not exported.

- [ ] **Step 3: Implement**

Append to `src/names.ts`:

```ts
export const NOTE_MAX = 80;

// A bill's note ("Woolies, Sat") is shown to the whole house like a name, so
// it gets the same cleaning. It may be empty.
export function normaliseNote(raw: string): string | null {
  const note = raw.trim().replace(/\s+/g, " ").normalize("NFC");
  if ([...note].length > NOTE_MAX) return null;
  if (/\p{Cc}/u.test(note) || BIDI_CONTROLS.test(note)) return null;
  return note;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm test:unit spec/unit/names.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/names.ts spec/unit/names.test.ts
git commit -m "feat: clean bill notes the way names are cleaned"
```

---

### Task 3: Store bills and payments, drop the kitchen

**Files:**
- Modify: `src/store.ts`
- Delete: `src/rules.ts`, `spec/unit/rules.test.ts`
- Test: `spec/unit/store.test.ts`

**Interfaces:**
- Consumes: `Share`, `BillRecord`, `PaymentRecord`, `PaymentStatus`, `MAX_CENTS` from `src/money.ts`.
- Produces (on `Store`, kept: `createHouse`, `houseExists`, `join`, `claim`, `personByToken`, `people`, `close`):
  - `type Bill = BillRecord & { at: number }`, `type Payment = PaymentRecord & { at: number }`
  - `addBill(code: string, payerId: number, note: string, shares: Share[]): number | null`
  - `deleteBill(code: string, billId: number, requesterId: number): "deleted" | "not_yours" | "gone"`
  - `recordPayment(code: string, fromId: number, toId: number, cents: number): number | null`
  - `answerPayment(code: string, paymentId: number, requesterId: number, answer: "received" | "rejected"): "done" | "not_yours" | "already" | "gone"`
  - `bills(code: string): Bill[]` — newest first, shares in insertion order
  - `payments(code: string): Payment[]` — newest first, all statuses
  - Removed: `startCooking`, `stopCooking`, `mark`, `history`, types `History`.

- [ ] **Step 1: Write the failing tests**

In `spec/unit/store.test.ts`: delete the `describe("cooking and marking", …)` and `describe("house scoping", …)` blocks entirely, replace the `describe("persistence", …)` block, and add the blocks below. Keep `houses`, `joining` and `identity` as they are.

```ts
function house(store: Store, ...names: string[]) {
  const code = store.createHouse();
  const ids = names.map((n) => joinOk(store, code, n).person.id);
  return { code, ids };
}

describe("bills", () => {
  it("stores a bill with its shares, newest first, leaving zero shares out", () => {
    const store = memory();
    const { code, ids: [rafi, dina, ari] } = house(store, "Rafi", "Dina", "Ari");
    const first = store.addBill(code, rafi, "Groceries", [
      { personId: rafi, cents: 450 },
      { personId: dina, cents: 450 },
      { personId: ari, cents: 900 },
    ]);
    const second = store.addBill(code, dina, "", [{ personId: rafi, cents: 100 }, { personId: ari, cents: 0 }]);
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
    const { code, ids: [rafi] } = house(store, "Rafi");
    const other = house(store, "Zed");
    const zed = other.ids[0];
    expect(store.addBill(code, rafi, "", [])).toBeNull();
    expect(store.addBill(code, rafi, "", [{ personId: rafi, cents: 0 }])).toBeNull();
    expect(store.addBill(code, rafi, "", [{ personId: zed, cents: 100 }])).toBeNull();
    expect(store.addBill(code, zed, "", [{ personId: rafi, cents: 100 }])).toBeNull();
    expect(store.addBill(code, rafi, "", [{ personId: rafi, cents: 100 }, { personId: rafi, cents: 100 }])).toBeNull();
    expect(store.bills(code)).toEqual([]);
  });

  it("lets only the payer delete a bill, once, inside its house", () => {
    const store = memory();
    const { code, ids: [rafi, dina] } = house(store, "Rafi", "Dina");
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
    const { code, ids: [rafi, dina] } = house(store, "Rafi", "Dina");
    const id = store.recordPayment(code, dina, rafi, 1550);
    expect(store.payments(code)).toMatchObject([{ id, fromId: dina, toId: rafi, cents: 1550, status: "pending" }]);
  });

  it("refuses paying yourself, nobody, an outsider, or an amount out of range", () => {
    const store = memory();
    const { code, ids: [rafi] } = house(store, "Rafi", "Dina");
    const zed = house(store, "Zed").ids[0];
    expect(store.recordPayment(code, rafi, rafi, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, zed, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, 9999, 100)).toBeNull();
    expect(store.recordPayment(code, rafi, rafi + 1, 0)).toBeNull();
    expect(store.recordPayment(code, rafi, rafi + 1, 100_000_001)).toBeNull();
  });

  it("lets only the receiver answer, only once", () => {
    const store = memory();
    const { code, ids: [rafi, dina] } = house(store, "Rafi", "Dina");
    const id = store.recordPayment(code, dina, rafi, 100)!;
    expect(store.answerPayment(code, id, dina, "received")).toBe("not_yours");
    expect(store.answerPayment(code, id, rafi, "received")).toBe("done");
    expect(store.answerPayment(code, id, rafi, "rejected")).toBe("already");
    expect(store.payments(code)[0].status).toBe("received");
    expect(store.answerPayment(code, 9999, rafi, "received")).toBe("gone");
  });

  it("does not let another house answer a payment", () => {
    const store = memory();
    const { code, ids: [rafi, dina] } = house(store, "Rafi", "Dina");
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:unit spec/unit/store.test.ts`
Expected: FAIL, `store.addBill is not a function` (and similar).

- [ ] **Step 3: Implement**

In `src/store.ts`:

1. Replace the imports of `./rules.ts` with:

```ts
import { MAX_CENTS } from "./money.ts";
import type { BillRecord, PaymentRecord, PaymentStatus, Share } from "./money.ts";
```

2. Replace the exported types `History` and the row types `SessionRow`, `MarkRow` with:

```ts
export type Bill = BillRecord & { at: number };
export type Payment = PaymentRecord & { at: number };
```

and

```ts
type BillRow = { id: number; paid_by: number; note: string; created_at: number };
type ShareRow = { bill_id: number; person_id: number; cents: number };
type PaymentRow = { id: number; from_id: number; to_id: number; cents: number; status: string; created_at: number };
```

3. In `SCHEMA`, replace the `cook_sessions` and `kitchen_marks` tables with:

```sql
  drop table if exists cook_sessions;
  drop table if exists kitchen_marks;
  create table if not exists bills (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    paid_by integer not null references people(id),
    note text not null,
    created_at integer not null
  );
  create table if not exists bill_shares (
    bill_id integer not null references bills(id) on delete cascade,
    person_id integer not null references people(id),
    cents integer not null check (cents > 0),
    primary key (bill_id, person_id)
  );
  create table if not exists payments (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    from_id integer not null references people(id),
    to_id integer not null references people(id),
    cents integer not null check (cents > 0),
    status text not null default 'pending' check (status in ('pending', 'received', 'rejected')),
    created_at integer not null,
    resolved_at integer
  );
```

4. Update the comment on `now()` to: `// Strictly increasing within this process, so the history has one clear order.`

5. Remove `openSession`, `startCooking`, `stopCooking`, `mark`, `history`. Keep `inHouse`. Add:

```ts
  // A bill holds only the people with an amount above zero. It is refused when
  // nobody is left, when anyone in it (payer included) is not in this house, or
  // when a person appears twice.
  addBill(code: string, payerId: number, note: string, shares: Share[]): number | null {
    const kept = shares.filter((s) => s.cents !== 0);
    if (kept.length === 0 || !this.inHouse(code, payerId)) return null;
    if (new Set(kept.map((s) => s.personId)).size !== kept.length) return null;
    for (const s of kept) {
      if (!Number.isInteger(s.cents) || s.cents < 0 || s.cents > MAX_CENTS) return null;
      if (!this.inHouse(code, s.personId)) return null;
    }
    this.db.exec("begin");
    try {
      const id = Number(
        this.db
          .prepare("insert into bills (house_code, paid_by, note, created_at) values (?, ?, ?, ?)")
          .run(code, payerId, note, this.now()).lastInsertRowid,
      );
      const insert = this.db.prepare("insert into bill_shares (bill_id, person_id, cents) values (?, ?, ?)");
      for (const s of kept) insert.run(id, s.personId, s.cents);
      this.db.exec("commit");
      return id;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  // One conditional delete, so two requests can never both delete; the shares
  // go with the bill (on delete cascade).
  deleteBill(code: string, billId: number, requesterId: number): "deleted" | "not_yours" | "gone" {
    const result = this.db
      .prepare("delete from bills where id = ? and house_code = ? and paid_by = ?")
      .run(billId, code, requesterId);
    if (result.changes > 0) return "deleted";
    const exists = this.db.prepare("select 1 from bills where id = ? and house_code = ?").get(billId, code);
    return exists === undefined ? "gone" : "not_yours";
  }

  recordPayment(code: string, fromId: number, toId: number, cents: number): number | null {
    if (fromId === toId || !Number.isInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
    if (!this.inHouse(code, fromId) || !this.inHouse(code, toId)) return null;
    const result = this.db
      .prepare("insert into payments (house_code, from_id, to_id, cents, created_at) values (?, ?, ?, ?, ?)")
      .run(code, fromId, toId, cents, this.now());
    return Number(result.lastInsertRowid);
  }

  // Only the receiver answers, and only while the payment is pending. The check
  // and the change are one statement, so of two answers at once exactly one lands.
  answerPayment(
    code: string,
    paymentId: number,
    requesterId: number,
    answer: "received" | "rejected",
  ): "done" | "not_yours" | "already" | "gone" {
    const result = this.db
      .prepare(
        "update payments set status = ?, resolved_at = ? where id = ? and house_code = ? and to_id = ? and status = 'pending'",
      )
      .run(answer, this.now(), paymentId, code, requesterId);
    if (result.changes > 0) return "done";
    const row = this.db
      .prepare("select to_id from payments where id = ? and house_code = ?")
      .get(paymentId, code) as { to_id: number } | undefined;
    if (row === undefined) return "gone";
    return row.to_id === requesterId ? "already" : "not_yours";
  }

  bills(code: string): Bill[] {
    const rows = this.db
      .prepare("select id, paid_by, note, created_at from bills where house_code = ? order by created_at desc, id desc")
      .all(code) as BillRow[];
    const shareRows = this.db
      .prepare(
        "select s.bill_id, s.person_id, s.cents from bill_shares s join bills b on b.id = s.bill_id where b.house_code = ? order by s.rowid",
      )
      .all(code) as ShareRow[];
    const shares = new Map<number, Share[]>();
    for (const s of shareRows) {
      const list = shares.get(s.bill_id) ?? [];
      list.push({ personId: s.person_id, cents: s.cents });
      shares.set(s.bill_id, list);
    }
    return rows.map((r) => ({ id: r.id, paidBy: r.paid_by, note: r.note, at: r.created_at, shares: shares.get(r.id) ?? [] }));
  }

  payments(code: string): Payment[] {
    const rows = this.db
      .prepare(
        "select id, from_id, to_id, cents, status, created_at from payments where house_code = ? order by created_at desc, id desc",
      )
      .all(code) as PaymentRow[];
    return rows.map((r) => ({
      id: r.id,
      fromId: r.from_id,
      toId: r.to_id,
      cents: r.cents,
      status: r.status as PaymentStatus,
      at: r.created_at,
    }));
  }
```

Note: `bill_shares` has a composite primary key, so it still has a `rowid`; `order by s.rowid` keeps insertion order.

6. Delete the kitchen rules and their tests:

```bash
git rm src/rules.ts spec/unit/rules.test.ts
```

(`src/app.ts` and `src/pages.ts` still import `rules.ts` until Tasks 5–6; `pnpm typecheck` stays red until then. That is expected; the unit tests for the store run on their own.)

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test:unit spec/unit/store.test.ts spec/unit/money.test.ts spec/unit/names.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts spec/unit/store.test.ts
git commit -m "feat: store bills and payments in place of the kitchen"
```

---

### Task 4: The live hub

**Files:**
- Create: `src/live.ts`
- Test: `spec/unit/live.test.ts`

**Interfaces:**
- Produces:
  - `type Stream = { writeHead(status: number, headers: Record<string, string>): unknown; write(chunk: string): unknown; end(): unknown; on(event: "close", listener: () => void): unknown }` (a `ServerResponse` satisfies it)
  - `class Hub { constructor(heartbeatMs?: number); open(code: string, stream: Stream): void; broadcast(code: string): void; count(code: string): number; closeAll(): void }`
  - Wire format: on open `": connected\n\n"`; on change `"event: changed\ndata: 1\n\n"`; heartbeat `": ping\n\n"`.

- [ ] **Step 1: Write the failing test**

`spec/unit/live.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hub } from "../../src/live.ts";

class FakeStream {
  status = 0;
  headers: Record<string, string> = {};
  written: string[] = [];
  ended = false;
  private listeners: (() => void)[] = [];
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
  }
  write(chunk: string) {
    this.written.push(chunk);
  }
  end() {
    this.ended = true;
  }
  on(_event: "close", listener: () => void) {
    this.listeners.push(listener);
  }
  disconnect() {
    for (const l of this.listeners) l();
  }
}

const hubs: Hub[] = [];
const hub = (ms?: number): Hub => {
  const h = new Hub(ms);
  hubs.push(h);
  return h;
};
afterEach(() => {
  while (hubs.length > 0) hubs.pop()!.closeAll();
  vi.useRealTimers();
});

describe("Hub", () => {
  it("opens an event stream and says so at once", () => {
    const s = new FakeStream();
    hub().open("ABC234", s);
    expect(s.status).toBe(200);
    expect(s.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(s.written).toEqual([": connected\n\n"]);
  });

  it("tells every stream in a house, and none in another", () => {
    const h = hub();
    const a1 = new FakeStream();
    const a2 = new FakeStream();
    const b = new FakeStream();
    h.open("AAAAAA", a1);
    h.open("AAAAAA", a2);
    h.open("BBBBBB", b);
    h.broadcast("AAAAAA");
    // An event with empty data is never delivered by EventSource, so data is non-empty.
    expect(a1.written.at(-1)).toBe("event: changed\ndata: 1\n\n");
    expect(a2.written.at(-1)).toBe("event: changed\ndata: 1\n\n");
    expect(b.written).toEqual([": connected\n\n"]);
  });

  it("forgets a stream once it closes", () => {
    const h = hub();
    const s = new FakeStream();
    h.open("AAAAAA", s);
    expect(h.count("AAAAAA")).toBe(1);
    s.disconnect();
    expect(h.count("AAAAAA")).toBe(0);
    h.broadcast("AAAAAA");
    expect(s.written).toEqual([": connected\n\n"]);
  });

  it("sends a heartbeat so an idle stream is not dropped", () => {
    vi.useFakeTimers();
    const h = hub(25_000);
    const s = new FakeStream();
    h.open("AAAAAA", s);
    vi.advanceTimersByTime(25_000);
    expect(s.written.at(-1)).toBe(": ping\n\n");
  });

  it("ends every stream on closeAll", () => {
    const h = hub();
    const s = new FakeStream();
    h.open("AAAAAA", s);
    h.closeAll();
    expect(s.ended).toBe(true);
    expect(h.count("AAAAAA")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test:unit spec/unit/live.test.ts`
Expected: FAIL, cannot find module `../../src/live.ts`.

- [ ] **Step 3: Implement**

`src/live.ts`:

```ts
// Live updates. Each open house page holds one server-sent-events stream. After
// any change in a house, every stream in that house is told "changed" and the
// page fetches itself again; no other house hears about it.

export type Stream = {
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "close", listener: () => void): unknown;
};

export class Hub {
  private houses = new Map<string, Set<Stream>>();
  private timer: ReturnType<typeof setInterval>;

  // Fly's proxy closes a connection that has been silent for a while, so a
  // comment line goes out on every stream at this interval.
  constructor(heartbeatMs = 25_000) {
    this.timer = setInterval(() => this.beat(), heartbeatMs);
    this.timer.unref();
  }

  open(code: string, stream: Stream): void {
    stream.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    // Sent at once so the browser (and a check) knows the stream is open.
    stream.write(": connected\n\n");
    const streams = this.houses.get(code) ?? new Set<Stream>();
    this.houses.set(code, streams);
    streams.add(stream);
    stream.on("close", () => {
      streams.delete(stream);
      if (streams.size === 0 && this.houses.get(code) === streams) this.houses.delete(code);
    });
  }

  // EventSource drops an event whose data is empty, so the data is "1".
  broadcast(code: string): void {
    for (const stream of this.houses.get(code) ?? []) stream.write("event: changed\ndata: 1\n\n");
  }

  count(code: string): number {
    return this.houses.get(code)?.size ?? 0;
  }

  private beat(): void {
    for (const streams of this.houses.values()) for (const stream of streams) stream.write(": ping\n\n");
  }

  // On shutdown: open streams would otherwise keep the server from closing.
  closeAll(): void {
    clearInterval(this.timer);
    for (const streams of this.houses.values()) for (const stream of streams) stream.end();
    this.houses.clear();
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm test:unit spec/unit/live.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/live.ts spec/unit/live.test.ts
git commit -m "feat: add the per-house event stream hub"
```

---

### Task 5: The house page

**Files:**
- Modify: `src/pages.ts`
- Test: `spec/unit/pages.test.ts`

**Interfaces:**
- Consumes: `formatCents` from `src/money.ts`; `NOTE_MAX`, `NAME_MAX` from `src/names.ts`; `Person` from `src/store.ts`.
- Produces:
  - `type Draft = { note: string; total: string; amounts: Record<number, string>; ticked: number[]; message?: string }`
  - `type Entry = { kind: "bill"; id: number; paidBy: Person; note: string; shares: { person: Person; cents: number }[]; mine: boolean } | { kind: "payment"; from: Person; to: Person; cents: number; pending: boolean }`
  - `type HouseView = { code: string; me: Person; people: Person[]; balances: { person: Person; cents: number }[]; toAnswer: { id: number; from: Person; cents: number }[]; waiting: { to: Person; cents: number }[]; history: Entry[]; draft?: Draft }`
  - `housePage(view: HouseView): string`
  - `layout(title: string, body: string, script?: string): string`
  - Kept: `esc`, `homePage`, `joinPage`, `messagePage`. Removed: `kitchenPage`, `handoffPage`, `KitchenView`.
  - Page anatomy used by later checks: `#live[data-base="/h/CODE"]` holds `#balances` (a `ul` of `li`, or a `p` when empty), the "Did you get these?" list, the "Waiting for them to confirm" list and `#history` (a `ul` of `li`, or a `p` when empty). The bill form (`action="/h/CODE/bill"`) and payment form (`action="/h/CODE/pay"`) are outside `#live`.

- [ ] **Step 1: Write the failing tests**

In `spec/unit/pages.test.ts`: change the import to

```ts
import { esc, homePage, housePage, joinPage, layout } from "../../src/pages.ts";
import type { HouseView } from "../../src/pages.ts";
```

remove the `view` fixture, the `describe("kitchen page", …)` and `describe("handoff page", …)` blocks, and add `const ari = { id: 3, name: "Ari" };` beside `dani` and `rafi`. Where a join-page test expects the text "Go to the kitchen", change it to "Go to your house". Add:

```ts
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
    const html = housePage(house({ balances: [{ person: ari, cents: 100 }, { person: dani, cents: -900 }] }));
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
          { kind: "bill", id: 1, paidBy: rafi, note: "Woolies", shares: [{ person: ari, cents: 900 }, { person: dani, cents: 450 }], mine: true },
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
      housePage(house({ draft: { note: "Woolies", total: "10", amounts: { 3: "3.33", 2: "", 1: "3.34" }, ticked: [3, 1], message: "Check the amounts" } })),
    );
    expect(d.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe("Woolies");
    expect(d.querySelector<HTMLInputElement>('input[name="amount_3"]')!.value).toBe("3.33");
    expect(d.querySelector<HTMLInputElement>('input[name="with_2"]')!.checked).toBe(false);
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:unit spec/unit/pages.test.ts`
Expected: FAIL, `housePage` is not exported.

- [ ] **Step 3: Implement**

In `src/pages.ts`:

1. Replace the imports and the `KitchenView` type with:

```ts
import { formatCents } from "./money.ts";
import { NAME_MAX, NOTE_MAX } from "./names.ts";
import type { Person } from "./store.ts";

export type Draft = { note: string; total: string; amounts: Record<number, string>; ticked: number[]; message?: string };

export type Entry =
  | { kind: "bill"; id: number; paidBy: Person; note: string; shares: { person: Person; cents: number }[]; mine: boolean }
  | { kind: "payment"; from: Person; to: Person; cents: number; pending: boolean };

export type HouseView = {
  code: string;
  me: Person;
  people: Person[];
  // Non-zero only, in name order. Positive: they owe me. Negative: I owe them.
  balances: { person: Person; cents: number }[];
  toAnswer: { id: number; from: Person; cents: number }[];
  waiting: { to: Person; cents: number }[];
  history: Entry[];
  draft?: Draft;
};
```

2. Add to `STYLE`:

```css
  fieldset { border: 0; padding: 0; margin: 0.5rem 0; }
  fieldset p { margin: 0.25rem 0; }
  #live li { margin: 0.25rem 0; }
```

3. Give `layout` an optional script:

```ts
export function layout(title: string, body: string, script = ""): string {
```

and before `</body>` insert `${script === "" ? "" : `<script>${script}</script>`}` on its own line.

4. In `homePage`, change the title and heading `Kitchen` to `Serumah`, and the paragraph to `<p>Split your house's bills and see who owes whom.</p>`. In `joinPage`, change the link text `Go to the kitchen` to `Go to your house`.

5. Delete `kitchenPage` and `handoffPage`. Add:

```ts
// Live updates: the server says "changed" on this house's event stream, and
// the page fetches itself again and swaps in the new #live section. The forms
// sit outside #live, so a half-typed bill is never wiped. The page also
// re-fetches whenever the stream (re)opens, so someone coming back, or whose
// connection dropped, sees the current state. Without script, every form still
// works; only the live updates are lost.
const LIVE_SCRIPT = `
  let live = document.getElementById("live");
  const base = live.dataset.base;
  async function refresh() {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) return;
    const next = new DOMParser().parseFromString(await res.text(), "text/html").getElementById("live");
    if (next) {
      live.replaceWith(next);
      live = next;
    }
  }
  const events = new EventSource(base + "/events");
  events.addEventListener("changed", () => refresh().catch(() => {}));
  events.addEventListener("open", () => refresh().catch(() => {}));
`;

function balanceLine(b: { person: Person; cents: number }): string {
  const name = `<span class="name">${esc(b.person.name)}</span>`;
  return b.cents > 0 ? `<li>${name} owes you ${formatCents(b.cents)}</li>` : `<li>You owe ${name} ${formatCents(-b.cents)}</li>`;
}

function entryLine(entry: Entry, base: string): string {
  if (entry.kind === "payment") {
    const waiting = entry.pending ? ` <span class="quiet">(waiting for ${esc(entry.to.name)})</span>` : "";
    return `<li>${esc(entry.from.name)} paid ${esc(entry.to.name)} ${formatCents(entry.cents)}${waiting}</li>`;
  }
  const total = entry.shares.reduce((sum, s) => sum + s.cents, 0);
  const what = entry.note === "" ? "a bill" : esc(entry.note);
  const shares = entry.shares.map((s) => `${esc(s.person.name)} ${formatCents(s.cents)}`).join(", ");
  const remove = entry.mine ? postForm(`${base}/delete`, { bill: String(entry.id) }, "Delete") : "";
  return `<li>${esc(entry.paidBy.name)} paid ${formatCents(total)} for ${what}: ${shares}${remove}</li>`;
}

export function housePage(view: HouseView): string {
  const base = `/h/${view.code}`;
  const draft = view.draft ?? { note: "", total: "", amounts: {}, ticked: view.people.map((p) => p.id) };

  const balances =
    view.balances.length === 0
      ? `<p id="balances">Nobody owes anybody.</p>`
      : `<ul id="balances">${view.balances.map(balanceLine).join("")}</ul>`;
  const toAnswer =
    view.toAnswer.length === 0
      ? ""
      : `
        <h2>Did you get these?</h2>
        <ul>${view.toAnswer
          .map(
            (p) =>
              `<li>${esc(p.from.name)} says they paid you ${formatCents(p.cents)} ${postForm(`${base}/answer`, { payment: String(p.id), answer: "received" }, "Got it")}${postForm(`${base}/answer`, { payment: String(p.id), answer: "rejected" }, "Didn't get it")}</li>`,
          )
          .join("")}</ul>`;
  const waiting =
    view.waiting.length === 0
      ? ""
      : `
        <h2>Waiting for them to confirm</h2>
        <ul>${view.waiting.map((p) => `<li>You paid ${esc(p.to.name)} ${formatCents(p.cents)}</li>`).join("")}</ul>`;
  const history =
    view.history.length === 0
      ? `<p id="history">No bills yet.</p>`
      : `<ul id="history">${view.history.map((e) => entryLine(e, base)).join("")}</ul>`;

  const rows = view.people
    .map(
      (p) =>
        `<p><label><input type="checkbox" name="with_${p.id}"${draft.ticked.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label> <input name="amount_${p.id}" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.amounts[p.id] ?? "")}" aria-label="${esc(p.name)}'s amount" /></p>`,
    )
    .join("\n          ");
  const others = view.people.filter((p) => p.id !== view.me.id);
  const payForm =
    others.length === 0
      ? `<p class="quiet">Nobody else is in the house yet. Share the code <strong>${esc(view.code)}</strong>.</p>`
      : `<form method="post" action="${esc(base)}/pay">
        <label>To <select name="to">${others.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
        <label>Amount <input name="amount" inputmode="decimal" size="8" required autocomplete="off" /></label>
        <button type="submit">I paid this</button>
      </form>`;

  return layout(
    "Serumah",
    `      <h1>Serumah</h1>
      <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong> · <a href="${esc(base)}/join">Not you?</a></p>
      <section id="live" data-base="${esc(base)}">
        <h2>Balances</h2>
        ${balances}${toAnswer}${waiting}
        <h2>History</h2>
        ${history}
      </section>
      <h2>Add a bill you paid</h2>
      <form method="post" action="${esc(base)}/bill">
        ${alertLine(draft.message)}
        <label>What for <input name="note" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(draft.note)}" /></label>
        <fieldset>
          <legend>Who owes what (in dollars)</legend>
          ${rows}
        </fieldset>
        <button type="submit" name="intent" value="add">Add bill</button>
        <p><label>Or split a total equally between the ticked people <input name="total" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.total)}" /></label>
        <button type="submit" name="intent" value="fill">Split equally</button></p>
      </form>
      <h2>Record a payment you made</h2>
      ${payForm}`,
    LIVE_SCRIPT,
  );
}
```

"Add bill" comes first so pressing Enter in a box adds the bill rather than refilling the form.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm test:unit spec/unit/pages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages.ts spec/unit/pages.test.ts
git commit -m "feat: show balances, payments and history on the house page"
```

---

### Task 6: Routes for bills and payments

**Files:**
- Modify: `src/app.ts`, `src/main.ts`, `spec/helpers.ts`, `spec/houses.test.ts`
- Delete: `spec/kitchen.test.ts`
- Create: `spec/money.test.ts`

**Interfaces:**
- Consumes: Store methods from Task 3; `parseCents`, `equalSplit`, `plainCents`, `balancesFor`, `Share` from Task 1; `normaliseNote`, `NOTE_MAX` from Task 2; `Hub` from Task 4; `housePage`, `HouseView`, `Draft`, `Entry` from Task 5.
- Produces:
  - `createHandler(store: Store, hub: Hub)`
  - Routes (all under an existing house; acting ones need the house cookie, else 303 to `/h/CODE/join`):
    - `GET /h/CODE` → 200 house page
    - `POST /h/CODE/bill` fields `note`, `intent` (`add` default | `fill`), `total`, `with_<id>`, `amount_<id>` → `add`: 303 to `/h/CODE` (400 with the form refilled on bad input); `fill`: 200 with amounts filled, nothing saved
    - `POST /h/CODE/delete` field `bill` → 303 | 403 not yours | 404 gone
    - `POST /h/CODE/pay` fields `to`, `amount` → 303 | 400
    - `POST /h/CODE/answer` fields `payment`, `answer` (`received`|`rejected`) → 303 | 403 | 404 | 409 already answered
  - Helpers in `spec/helpers.ts`: `housePage(code, cookie)`, `addBill(code, cookie, note, amounts)`, `balancesOf(html)`, `historyOf(html)`, `setUpHouse(...names)`.

- [ ] **Step 1: Update the helpers**

In `spec/helpers.ts`: delete `cookingListOf`; rename `kitchen` to `housePage` (its error message to `the house page gave …`); add:

```ts
const lines = (html: string, selector: string): string[] =>
  [...parse(html).querySelectorAll(selector)].map((n) => (n.textContent ?? "").replace(/\s+/g, " ").trim());
export const balancesOf = (html: string): string[] => lines(html, "#balances li");
export const historyOf = (html: string): string[] => lines(html, "#history li");

// Amounts are keyed by person id, as typed into the boxes.
export function addBill(code: string, cookie: string, note: string, amounts: Record<string, string>): Promise<Response> {
  const form: Form = { note, intent: "add" };
  for (const [id, amount] of Object.entries(amounts)) form[`amount_${id}`] = amount;
  return post(`/h/${code}/bill`, cookie, form);
}

// A house with these people in it: their cookies and ids by name.
export async function setUpHouse(...names: string[]) {
  const code = await newHouse();
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  for (const name of names) {
    cookies[name] = await joinAs(code, name);
    ids[name] = await personIdOf(code, name);
  }
  return { code, cookies, ids };
}
```

- [ ] **Step 2: Update the house checks**

In `spec/houses.test.ts`:
- Import `addBill, historyOf, housePage` instead of `cookingListOf, kitchen`.
- Rename "lets you join with a name and see the kitchen as that person" to "lets you join with a name and see the house as that person", using `housePage`.
- Replace the body of "finds you, and the house as you left it, on a later visit" with:

```ts
    const code = await newHouse();
    const cookie = await joinAs(code, "Dani");
    const id = await personIdOf(code, "Dani");
    expect((await addBill(code, cookie, "Rice", { [id]: "5" })).status).toBe(303);
    const later = await housePage(code, cookie);
    expect(textOf(later)).toContain("you are Dani");
    // The line ends with Dani's own "Delete" button, hence toContain.
    expect(historyOf(later)).toHaveLength(1);
    expect(historyOf(later)[0]).toContain("Dani paid $5.00 for Rice: Dani $5.00");
```

- In "lets someone claim an existing name from a new device" and "shows a name containing markup as text, on the join and kitchen pages", replace `kitchen(` with `housePage(`; rename the latter to "… on the join and house pages".
- In "does not let a person from one house act in another", replace the post with `post(\`/h/${b}/bill\`, cookie, { note: "x", intent: "add" })`.

Delete the kitchen checks: `git rm spec/kitchen.test.ts`.

- [ ] **Step 3: Write the failing money checks**

`spec/money.test.ts`:

```ts
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
```

- [ ] **Step 4: Implement the routes**

In `src/app.ts`:

1. Replace the imports with:

```ts
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hub } from "./live.ts";
import { balancesFor, equalSplit, parseCents, plainCents } from "./money.ts";
import type { Share } from "./money.ts";
import { NAME_MAX, NOTE_MAX, normaliseNote } from "./names.ts";
import { homePage, housePage, joinPage, messagePage } from "./pages.ts";
import type { Draft, Entry, HouseView } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import type { Person, Store } from "./store.ts";
```

2. Replace `viewFor` with:

```ts
function viewFor(store: Store, code: string, me: Person, draft?: Draft): HouseView {
  const people = store.people(code);
  const byId = new Map<number, Person>(people.map((p) => [p.id, p] as const));
  const order = new Map<number, number>(people.map((p, i) => [p.id, i] as const));
  const who = (id: number): Person => byId.get(id) ?? { id, name: "someone" };
  const bills = store.bills(code);
  const payments = store.payments(code);
  const net = balancesFor(me.id, bills, payments);

  const dated: { at: number; entry: Entry }[] = [];
  for (const b of bills) {
    const shares = [...b.shares]
      .sort((x, y) => (order.get(x.personId) ?? 0) - (order.get(y.personId) ?? 0))
      .map((s) => ({ person: who(s.personId), cents: s.cents }));
    dated.push({ at: b.at, entry: { kind: "bill", id: b.id, paidBy: who(b.paidBy), note: b.note, shares, mine: b.paidBy === me.id } });
  }
  // A payment the receiver said they didn't get is gone from the page.
  for (const p of payments) {
    if (p.status === "rejected") continue;
    dated.push({ at: p.at, entry: { kind: "payment", from: who(p.fromId), to: who(p.toId), cents: p.cents, pending: p.status === "pending" } });
  }
  dated.sort((x, y) => y.at - x.at);

  return {
    code,
    me,
    people,
    balances: people.filter((p) => net.has(p.id)).map((p) => ({ person: p, cents: net.get(p.id) ?? 0 })),
    toAnswer: payments
      .filter((p) => p.status === "pending" && p.toId === me.id)
      .map((p) => ({ id: p.id, from: who(p.fromId), cents: p.cents })),
    waiting: payments
      .filter((p) => p.status === "pending" && p.fromId === me.id)
      .map((p) => ({ to: who(p.toId), cents: p.cents })),
    history: dated.map((d) => d.entry),
    draft,
  };
}

// A whole number id from a form field, or null.
function idFrom(raw: string | null): number | null {
  const id = Number(raw ?? "");
  return raw !== null && raw.trim() !== "" && Number.isInteger(id) && id > 0 ? id : null;
}
```

3. Thread the hub through: `export function createHandler(store: Store, hub: Hub)`; `await route(store, hub, req, res)`; `async function route(store: Store, hub: Hub, req…)`; `return house(store, hub, req, res, code, method, action)`; `async function house(store: Store, hub: Hub, req: IncomingMessage, …)`.

4. In `house`, replace everything from `if (method === "GET" && action === "") {` to the final `return notFound(res);` with:

```ts
  if (method === "GET" && action === "") {
    return sendHtml(res, 200, housePage(viewFor(store, code, me)));
  }
  if (method === "POST" && action === "bill") {
    const form = await readForm(req);
    const people = store.people(code);
    const draft: Draft = {
      note: form.get("note") ?? "",
      total: form.get("total") ?? "",
      amounts: Object.fromEntries(people.map((p) => [p.id, form.get(`amount_${p.id}`) ?? ""] as const)),
      ticked: people.filter((p) => form.has(`with_${p.id}`)).map((p) => p.id),
    };
    const again = (message: string): void =>
      sendHtml(res, 400, housePage(viewFor(store, code, me, { ...draft, message })));
    const note = normaliseNote(draft.note);
    if (note === null) return again(`Keep the note to ${NOTE_MAX} characters, without control characters.`);

    if (form.get("intent") === "fill") {
      const total = parseCents(draft.total);
      if (total === null || total === 0) return again("Type the total in dollars, like 18.50.");
      if (draft.ticked.length === 0) return again("Tick who shares it.");
      const split = new Map(equalSplit(total, draft.ticked, me.id).map((s) => [s.personId, s.cents] as const));
      for (const p of people) {
        const cents = split.get(p.id);
        draft.amounts[p.id] = cents === undefined ? "" : plainCents(cents);
      }
      return sendHtml(res, 200, housePage(viewFor(store, code, me, draft)));
    }

    // People who joined after the form was drawn have no box, so only the
    // house's people are read, and an id from anywhere else is ignored.
    const shares: Share[] = [];
    for (const p of people) {
      const raw = (draft.amounts[p.id] ?? "").trim();
      if (raw === "") continue;
      const cents = parseCents(raw);
      if (cents === null) return again(`${p.name}'s amount doesn't look like dollars. Use a number like 4.50.`);
      if (cents > 0) shares.push({ personId: p.id, cents });
    }
    if (shares.length === 0) return again("Put an amount next to at least one person.");
    if (store.addBill(code, me.id, note, shares) === null) throw new HttpError(400, "That bill couldn't be added.");
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "delete") {
    const id = idFrom((await readForm(req)).get("bill"));
    const outcome = id === null ? "gone" : store.deleteBill(code, id, me.id);
    if (outcome === "gone") throw new HttpError(404, "That bill isn't here any more.");
    if (outcome === "not_yours") throw new HttpError(403, "Only the person who paid can delete a bill.");
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "pay") {
    const form = await readForm(req);
    const cents = parseCents(form.get("amount") ?? "");
    if (cents === null || cents === 0) throw new HttpError(400, "Type the amount in dollars, like 15.50.");
    const to = idFrom(form.get("to"));
    if (to === null || store.recordPayment(code, me.id, to, cents) === null) {
      throw new HttpError(400, "Pick someone else in this house.");
    }
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "answer") {
    const form = await readForm(req);
    const answer = form.get("answer");
    if (answer !== "received" && answer !== "rejected") throw new HttpError(400, "Choose got it or didn't get it.");
    const id = idFrom(form.get("payment"));
    const outcome = id === null ? "gone" : store.answerPayment(code, id, me.id, answer);
    if (outcome === "gone") throw new HttpError(404, "That payment isn't in this house.");
    if (outcome === "not_yours") throw new HttpError(403, "Only the person who was paid can answer this.");
    if (outcome === "already") throw new HttpError(409, "That payment was already answered. Go back to your house to see how things stand.");
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  return notFound(res);
```

Remove the now-unused kitchen imports. Keep `NAME_MAX` (used by the join message).

5. In `src/main.ts`:

```ts
import { Hub } from "./live.ts";
```

create `const hub = new Hub();`, pass it: `createHandler(store, hub)`, and in the signal handler call `hub.closeAll();` before `server.close(…)`. Add a comment above the `Store` line: `// Still named kitchen.db so the houses and people made at Crit 8 carry over.`

- [ ] **Step 5: Typecheck and run everything**

Run: `pnpm typecheck`
Expected: no errors.

Start the app in a second terminal: `rm -rf /tmp/serumah-dev && DATA_DIR=/tmp/serumah-dev pnpm start`

Run: `pnpm test`
Expected: PASS, every file in `spec/` and `spec/unit/` (live HTTP checks don't exist yet).

- [ ] **Step 6: Commit**

```bash
git add -A src spec
git commit -m "feat: add bills and payments to the house, retire the kitchen"
```

---

### Task 7: The events route

**Files:**
- Modify: `src/app.ts`, `spec/helpers.ts`
- Create: `spec/live.test.ts`

**Interfaces:**
- Consumes: `Hub.open` from Task 4; `setUpHouse`, `addBill`, `post`, `newHouse`, `joinAs` from Task 6.
- Produces: `GET /h/CODE/events` → 200 `text/event-stream` for a person in the house; 403 for anyone else. Helper `openEvents(code, cookie)` in `spec/helpers.ts`.

- [ ] **Step 1: Add the stream helper**

Append to `spec/helpers.ts`:

```ts
// Opens a house's event stream the way EventSource would. `waitFor` reads until
// the text appears or `ms` passes; one read is kept pending across calls so no
// chunk is lost to a timeout.
export async function openEvents(code: string, cookie: string | undefined) {
  const controller = new AbortController();
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(new URL(`/h/${code}/events`, baseUrl), { headers, redirect: "manual", signal: controller.signal });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  async function waitFor(text: string, ms: number): Promise<boolean> {
    if (reader === undefined) return false;
    const deadline = Date.now() + ms;
    while (!buffer.includes(text)) {
      const left = deadline - Date.now();
      if (left <= 0) return false;
      pending ??= reader.read();
      const chunk = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), left))]);
      if (chunk === null) return false;
      pending = null;
      if (chunk.done) return false;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    buffer = buffer.slice(buffer.indexOf(text) + text.length);
    return true;
  }

  return { status: res.status, type: res.headers.get("content-type") ?? "", waitFor, close: () => controller.abort() };
}
```

- [ ] **Step 2: Write the failing checks**

`spec/live.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addBill, joinAs, newHouse, openEvents, post, setUpHouse } from "./helpers.ts";

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
    const rafi = await openEvents(code, cookies.Rafi);
    try {
      expect(await rafi.waitFor(": connected", 1000)).toBe(true);
      await post(`/h/${code}/pay`, cookies.Dina, { to: ids.Rafi, amount: "5" });
      expect(await rafi.waitFor(CHANGED, 1000)).toBe(true);
    } finally {
      rafi.close();
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
```

- [ ] **Step 3: Run them to see them fail**

Restart the app (`Ctrl-C`, then `DATA_DIR=/tmp/serumah-dev pnpm start`).
Run: `pnpm test spec/live.test.ts`
Expected: FAIL — the stream for a member answers 404, and a stranger gets 303, not 403.

- [ ] **Step 4: Implement**

In `src/app.ts`, in `house`, replace

```ts
  const me = current;
  if (me === null) return redirect(res, `/h/${code}/join`);
```

with

```ts
  const me = current;
  // A browser's EventSource can't follow a redirect to a page, so the stream
  // refuses outright instead.
  if (me === null && action === "events") throw new HttpError(403, "Join this house to see it live.");
  if (me === null) return redirect(res, `/h/${code}/join`);

  if (method === "GET" && action === "events") return hub.open(code, res);
```

The `HttpError` handler sets `connection: close` — fine for a refusal.

- [ ] **Step 5: Run them to see them pass**

Restart the app. Run: `pnpm check`
Expected: typecheck clean; every check passes.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts spec/helpers.ts spec/live.test.ts
git commit -m "feat: stream each house's changes to its open pages"
```

---

### Task 8: The rules in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite "What the app must never do"**

Replace the first bullet ("**Blame when the kitchen is clean.** …") with:

```markdown
- **Count a payment the receiver hasn't confirmed.** "I paid Dina back" changes no balance until Dina says she got it. A payment she says she didn't get is gone.
- **Let anyone act for the person concerned.** Only the payer deletes their bill; only the receiver answers a payment.
- **Get the money wrong.** Amounts are whole cents everywhere. An equal split adds up to its total exactly. Balances are worked out from the bills and received payments every time, never stored.
```

Replace the "**Nag.**" bullet with:

```markdown
- **Nag or shame.** No notifications, reminders, "overdue", rankings of who owes most, or emphasis on debts. Balances are plain facts in name order. The app shows the state when someone looks.
```

Keep the bullets on accounts, markup and houses as they are. In "How to work here", leave everything as is.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rules for Serumah's money in place of the kitchen's"
```

---

### Task 9: See it working, then ship

- [ ] **Step 1: Two people, two browsers**

With the app running locally, open `http://localhost:8080` in a normal Chrome window and an incognito window. Start a house in one, join it in the other with a second name. In window A add a bill for B; window B's balances and history change within a second with no reload. In B, record a payment; A sees "Did you get these?" appear; A taps "Got it"; B's balance clears live. Half-type a bill in B while A adds one: B's typing survives. Do it once at phone width (DevTools device toolbar).

- [ ] **Step 2: Evidence check**

Run: `pnpm check:evidence`
Expected: passes once the author's `reflections/crit-9.md` and rewritten `PROCESS.md` are in. If it fails only on those, that is the author's writing still to come — report it, don't write them.

- [ ] **Step 3: Ask the author before merging**

The repo is public: a push to `main` runs CI and deploys. Ask the author, then:

```bash
git switch main
git merge --ff-only serumah
git push origin main
```

- [ ] **Step 4: Watch CI and check the live app**

Run: `gh run watch` (pick the newest `checks` run). Then:

Run: `APP_URL=https://comp4020-final-fiardiel.fly.dev pnpm check`
Expected: PASS. Repeat Step 1 against the live URL with two browsers.
