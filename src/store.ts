import { randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nameKey, normaliseName } from "./names.ts";
import { kitchenState } from "./rules.ts";
import type { KitchenState, Mark, Session } from "./rules.ts";

export type Person = { id: number; name: string };
export type History = { sessions: Session[]; marks: Mark[] };
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
  create table if not exists cook_sessions (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    person_id integer not null references people(id),
    started_at integer not null,
    ended_at integer
  );
  create table if not exists kitchen_marks (
    id integer primary key autoincrement,
    house_code text not null references houses(code),
    state text not null check (state in ('clean', 'messy')),
    marked_by integer not null references people(id),
    marked_at integer not null
  );
`;

type PersonRow = { id: number; name: string };
type SessionRow = { person_id: number; started_at: number; ended_at: number | null };
type MarkRow = { state: string; marked_by: number; marked_at: number };

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

  // Strictly increasing within this process, so two events never share a time
  // and "started before the mess was marked" always has a clear answer.
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

  private openSession(code: string, personId: number): { id: number } | undefined {
    return this.db
      .prepare("select id from cook_sessions where house_code = ? and person_id = ? and ended_at is null")
      .get(code, personId) as { id: number } | undefined;
  }

  startCooking(code: string, personId: number): boolean {
    if (!this.inHouse(code, personId)) return false;
    if (this.openSession(code, personId) !== undefined) return false;
    this.db
      .prepare("insert into cook_sessions (house_code, person_id, started_at) values (?, ?, ?)")
      .run(code, personId, this.now());
    return true;
  }

  stopCooking(code: string, personId: number): boolean {
    const open = this.openSession(code, personId);
    if (open === undefined) return false;
    this.db.prepare("update cook_sessions set ended_at = ? where id = ?").run(this.now(), open.id);
    return true;
  }

  // A mark that repeats the current state records nothing. A repeat would
  // otherwise restart the mess and could move the blame to a later cook.
  mark(code: string, personId: number, state: KitchenState): boolean {
    if (!this.inHouse(code, personId)) return false;
    if (kitchenState(this.history(code).marks) === state) return false;
    this.db
      .prepare("insert into kitchen_marks (house_code, state, marked_by, marked_at) values (?, ?, ?, ?)")
      .run(code, state, personId, this.now());
    return true;
  }

  history(code: string): History {
    const sessions = this.db
      .prepare("select person_id, started_at, ended_at from cook_sessions where house_code = ? order by started_at")
      .all(code) as SessionRow[];
    const marks = this.db
      .prepare("select state, marked_by, marked_at from kitchen_marks where house_code = ? order by marked_at")
      .all(code) as MarkRow[];
    return {
      sessions: sessions.map((r) => ({ personId: r.person_id, startedAt: r.started_at, endedAt: r.ended_at })),
      marks: marks.map((r) => ({ state: r.state as KitchenState, markedBy: r.marked_by, at: r.marked_at })),
    };
  }
}
