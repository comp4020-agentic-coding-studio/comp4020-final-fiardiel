import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nameKey, normaliseName } from "./names.ts";
import { MAX_CENTS } from "./money.ts";
import type { BillRecord, PaymentRecord, PaymentStatus, Share } from "./money.ts";

export type Person = { id: number; name: string };
export type Bill = BillRecord & { at: number };
export type Payment = PaymentRecord & { at: number };
export type JoinOutcome =
  | { ok: true; person: Person; token: string }
  | { ok: false; reason: "no_house" | "invalid_name" | "name_taken" };

// No 0/O or 1/I, so a code read out loud or typed on a phone survives.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

const SCHEMA = `
  create table if not exists houses (
    code text primary key,
    created_at integer not null
  );
  create table if not exists people (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    name text not null,
    name_key text not null,
    token text not null unique,
    unique (house_code, name_key)
  );
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
`;

type PersonRow = { id: number; name: string };
type BillRow = { id: number; paid_by: number; note: string; created_at: number };
type ShareRow = { bill_id: number; person_id: number; cents: number };
type PaymentRow = { id: number; from_id: number; to_id: number; cents: number; status: string; created_at: number };

export class Store {
  private db: DatabaseSync;
  private lastAt = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // Strictly increasing within this process, so the history has one clear order.
  private now(): number {
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    return this.lastAt;
  }

  houseExists(code: string): boolean {
    return this.db.prepare("select 1 from houses where code = ?").get(code) !== undefined;
  }

  createHouse(): string {
    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.houseExists(code));
    this.db.prepare("insert into houses (code, created_at) values (?, ?)").run(code, this.now());
    return code;
  }

  join(code: string, rawName: string): JoinOutcome {
    if (!this.houseExists(code)) return { ok: false, reason: "no_house" };
    const name = normaliseName(rawName);
    if (name === null) return { ok: false, reason: "invalid_name" };
    const key = nameKey(name);
    const taken = this.db.prepare("select 1 from people where house_code = ? and name_key = ?").get(code, key);
    if (taken !== undefined) return { ok: false, reason: "name_taken" };
    const token = randomBytes(24).toString("hex");
    const result = this.db
      .prepare("insert into people (house_code, name, name_key, token) values (?, ?, ?, ?)")
      .run(code, name, key, token);
    return { ok: true, person: { id: Number(result.lastInsertRowid), name }, token };
  }

  // Taking over an existing name on a new device. The house code is the only
  // secret, which the spec accepts for a house of housemates.
  claim(code: string, personId: number): { person: Person; token: string } | null {
    const row = this.db
      .prepare("select id, name, token from people where id = ? and house_code = ?")
      .get(personId, code) as (PersonRow & { token: string }) | undefined;
    return row === undefined ? null : { person: { id: row.id, name: row.name }, token: row.token };
  }

  personByToken(code: string, token: string): Person | null {
    const row = this.db
      .prepare("select id, name from people where house_code = ? and token = ?")
      .get(code, token) as PersonRow | undefined;
    return row === undefined ? null : { id: row.id, name: row.name };
  }

  people(code: string): Person[] {
    const rows = this.db
      .prepare("select id, name from people where house_code = ? order by name_key")
      .all(code) as PersonRow[];
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  private inHouse(code: string, personId: number): boolean {
    return this.db.prepare("select 1 from people where id = ? and house_code = ?").get(personId, code) !== undefined;
  }

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
      .prepare("insert into payments (house_code, from_id, to_id, cents, status, created_at) values (?, ?, ?, ?, 'received', ?)")
      .run(code, fromId, toId, cents, this.now());
    return Number(result.lastInsertRowid);
  }

  // A payment counts as soon as it is recorded: the house trusts the payer.
  // Only the receiver, who can see whether the money arrived, can say it never
  // did, and then it stops counting. The check and the change are one
  // statement, so of two taps at once exactly one lands.
  disputePayment(code: string, paymentId: number, requesterId: number): "done" | "not_yours" | "already" | "gone" {
    const result = this.db
      .prepare(
        "update payments set status = 'rejected', resolved_at = ? where id = ? and house_code = ? and to_id = ? and status = 'received'",
      )
      .run(this.now(), paymentId, code, requesterId);
    if (result.changes > 0) return "done";
    const row = this.db.prepare("select to_id from payments where id = ? and house_code = ?").get(paymentId, code) as
      | { to_id: number }
      | undefined;
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
}
