// Money is whole cents everywhere: stored, added and compared. Dollars only
// appear at the edges, when someone types an amount or reads one.

export const MAX_CENTS = 100_000_000; // $1,000,000.00

export type Share = { personId: number; cents: number };
// One line off a receipt: its price (negative for a discount) and who shared it.
export type Item = { name: string; cents: number; people: number[] };
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

// The same, but a receipt's discount line may start with a minus.
export function parseSignedCents(raw: string): number | null {
  const t = raw.trim();
  const cents = parseCents(t.startsWith("-") ? t.slice(1) : t);
  return cents === null ? null : t.startsWith("-") ? -cents : cents;
}

const DOLLARS = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

export function formatCents(cents: number): string {
  return DOLLARS.format(cents / 100);
}

// The same amount as a person would type it back into a box.
export function plainCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function signedPlainCents(cents: number): string {
  return cents < 0 ? `-${plainCents(-cents)}` : plainCents(cents);
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

// Each item split equally between the people ticked on it (leftover cents as
// in equalSplit), then added up per person, so the shares add up to the items
// exactly. An item ticked on nobody is left out.
export function itemShares(items: Item[], payerId: number): Share[] {
  const sums = new Map<number, number>();
  for (const item of items) {
    for (const s of equalSplit(item.cents, item.people, payerId)) sums.set(s.personId, (sums.get(s.personId) ?? 0) + s.cents);
  }
  return [...sums].map(([personId, cents]) => ({ personId, cents }));
}

// A fee or credit on the whole receipt (a surcharge, rounding, a discount on
// the whole shop), shared in proportion to what each person had. The cents
// that don't divide evenly go to the payer if they're on the bill, otherwise
// to the first person, as in equalSplit, so the shares still add up exactly.
// With nothing to share it by, it is all the payer's.
export function withFees(shares: Share[], feeCents: number, payerId: number): Share[] {
  if (feeCents === 0) return shares;
  const base = shares.reduce((sum, s) => sum + s.cents, 0);
  if (base <= 0) {
    const payer = shares.find((s) => s.personId === payerId);
    return payer === undefined
      ? [...shares, { personId: payerId, cents: feeCents }]
      : shares.map((s) => (s === payer ? { ...s, cents: s.cents + feeCents } : s));
  }
  const sign = Math.sign(feeCents);
  const out = shares.map((s) => ({ personId: s.personId, cents: s.cents + sign * Math.floor((Math.abs(feeCents) * Math.max(s.cents, 0)) / base) }));
  const given = out.reduce((sum, s, i) => sum + s.cents - shares[i].cents, 0);
  const gets = out.find((s) => s.personId === payerId) ?? out[0];
  gets.cents += feeCents - given;
  return out;
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
