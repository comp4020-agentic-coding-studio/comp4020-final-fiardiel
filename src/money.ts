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
