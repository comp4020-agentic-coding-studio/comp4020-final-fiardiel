import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hub } from "./live.ts";
import { balancesFor, equalSplit, parseCents, plainCents } from "./money.ts";
import type { Share } from "./money.ts";
import { logAction } from "./log.ts";
import { NAME_MAX, NOTE_MAX, nameKey, normaliseName, normaliseNote } from "./names.ts";
import {
  billPage,
  historyPage,
  homePage,
  housePage,
  joinPage,
  messagePage,
  newNamePage,
  newPinPage,
  payPage,
  pinPage,
  resetCodePage,
  resetPinPage,
} from "./pages.ts";
import type { Draft, Entry, HouseView } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import type { Person, Store } from "./store.ts";

const README = new URL("../README.md", import.meta.url);
const CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;
const MAX_BODY = 4096;
const NO_SUCH_HOUSE = "There's no house with that code. Check it and try again.";
const BAD_PIN = "Pick a 4-digit PIN.";
const BAD_NAME = `Pick a name of 1 to ${NAME_MAX} characters, without control characters.`;
const NAME_TAKEN = "That name is taken. If it's you, go back and tap your name.";

// What people type as a house code: spaces dropped, upper-cased.
const typedCode = (raw: string | null): string => (raw ?? "").replace(/\s+/g, "").toUpperCase();

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseUrl(raw: string | undefined): URL {
  try {
    return new URL(raw ?? "/", "http://localhost");
  } catch {
    throw new HttpError(400, "That address doesn't look right.");
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, cookie?: string): void {
  res.writeHead(303, cookie === undefined ? { location } : { location, "set-cookie": cookie });
  res.end();
}

function notFound(res: ServerResponse): void {
  sendHtml(res, 404, messagePage("Not found", "There's nothing at this address."));
}

// Form bodies here are a few short fields, so anything bigger is refused. The
// rest of an oversized body is read and thrown away before refusing: leaving
// the loop early would destroy the socket and the 413 would never be sent.
async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_BODY) chunks.push(chunk as Buffer);
  }
  if (size > MAX_BODY) throw new HttpError(413, "That request is too large.");
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function cookieName(code: string): string {
  return `person_${code}`;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

// Every house this browser has a person in. Cookies that are garbage, stale or
// for another house's token identify nobody and are dropped.
function myHouses(store: Store, req: IncomingMessage): { code: string; name: string }[] {
  const found: { code: string; name: string }[] = [];
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    const code = key.match(/^person_([23456789A-HJ-NP-Z]{6})$/)?.[1];
    if (code === undefined) continue;
    const person = store.personByToken(code, rest.join("="));
    if (person !== null) found.push({ code, name: person.name });
  }
  return found;
}

function cookieFor(req: IncomingMessage, code: string, token: string): string {
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `${cookieName(code)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function viewFor(store: Store, code: string, me: Person): HouseView {
  const people = store.people(code);
  const byId = new Map<number, Person>(people.map((p) => [p.id, p] as const));
  const order = new Map<number, number>(people.map((p, i) => [p.id, i] as const));
  const who = (id: number): Person => byId.get(id) ?? { id, name: "someone" };
  const bills = store.bills(code);
  const payments = store.payments(code);
  const net = balancesFor(me.id, bills, payments);

  // History shows only what involves the viewer: bills they paid or have a
  // share in, and payments to or from them. Balances still use everything.
  const dated: { at: number; entry: Entry }[] = [];
  for (const b of bills) {
    if (b.paidBy !== me.id && !b.shares.some((s) => s.personId === me.id)) continue;
    const shares = [...b.shares]
      .sort((x, y) => (order.get(x.personId) ?? 0) - (order.get(y.personId) ?? 0))
      .map((s) => ({ person: who(s.personId), cents: s.cents }));
    dated.push({
      at: b.at,
      entry: { kind: "bill", id: b.id, paidBy: who(b.paidBy), note: b.note, shares, mine: b.paidBy === me.id },
    });
  }
  // A PIN change is about the house's names, so everyone sees it.
  for (const c of store.pinChanges(code)) dated.push({ at: c.at, entry: { kind: "pin", person: who(c.personId) } });
  // A payment the receiver said never arrived is gone from the page.
  for (const p of payments) {
    if (p.status === "rejected" || (p.fromId !== me.id && p.toId !== me.id)) continue;
    dated.push({
      at: p.at,
      entry: { kind: "payment", id: p.id, from: who(p.fromId), to: who(p.toId), cents: p.cents, toMe: p.toId === me.id },
    });
  }
  dated.sort((x, y) => y.at - x.at);

  return {
    code,
    me,
    people,
    balances: people.filter((p) => net.has(p.id)).map((p) => ({ person: p, cents: net.get(p.id) ?? 0 })),
    history: dated.map((d) => d.entry),
  };
}

// A whole number id from a form field, or null.
function idFrom(raw: string | null): number | null {
  const id = Number(raw ?? "");
  return raw !== null && raw.trim() !== "" && Number.isInteger(id) && id > 0 ? id : null;
}

export function createHandler(store: Store, hub: Hub) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(store, hub, req, res);
    } catch (error) {
      if (res.headersSent) {
        // A response has already started; a second one cannot be written.
        console.error(error);
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        res.setHeader("connection", "close");
        sendHtml(res, error.status, messagePage("That didn't work", error.message));
        return;
      }
      console.error(error);
      sendHtml(res, 500, messagePage("Something broke", "Something went wrong on our side. Try again in a moment."));
    }
  };
}

async function route(store: Store, hub: Hub, req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Node leaves the body off a HEAD response, so HEAD is routed as GET.
  const method = req.method === "HEAD" ? "GET" : (req.method ?? "GET");
  const url = parseUrl(req.url);
  const path = url.pathname;

  if (method === "GET" && path === "/") return sendHtml(res, 200, homePage(undefined, myHouses(store, req)));
  if (method === "GET" && path === "/readme") return redirect(res, "/readme/");
  if (method === "GET" && path === "/readme/") {
    return sendHtml(res, 200, renderReadmePage(readFileSync(README, "utf8")));
  }
  if (method === "POST" && path === "/houses") {
    const code = store.createHouse();
    logAction(store.houseLabel(code), null, "create_house");
    return redirect(res, `/h/${code}/join`);
  }
  if (method === "GET" && path === "/join") {
    const code = typedCode(url.searchParams.get("code"));
    if (CODE_RE.test(code) && store.houseExists(code)) return redirect(res, `/h/${code}/join`);
    return sendHtml(res, 404, homePage(NO_SUCH_HOUSE, myHouses(store, req)));
  }

  const match = path.match(/^\/h\/([^/]+)(?:\/([a-z]+)(?:\/(\d+))?)?\/?$/);
  if (match === null) return notFound(res);
  const [, code, action = "", id] = match;
  // Only the PIN and reset pages are about one person, and they need one.
  if ((id !== undefined) !== (action === "as" || action === "reset")) return notFound(res);
  // The home form upper-cases what people type, so a lower-case code in an address
  // is sent to the upper-case one. Only reading is redirected: a POST stays a 404.
  const upper = code.toUpperCase();
  if (method === "GET" && code !== upper && CODE_RE.test(upper)) {
    const rest = id === undefined ? action : `${action}/${id}`;
    return redirect(res, rest === "" ? `/h/${upper}` : `/h/${upper}/${rest}`);
  }
  if (!CODE_RE.test(code) || !store.houseExists(code)) {
    return sendHtml(res, 404, messagePage("No such house", NO_SUCH_HOUSE));
  }
  if (id !== undefined) return person(store, hub, req, res, code, method, action, Number(id));
  return house(store, hub, req, res, code, method, action);
}

async function house(
  store: Store,
  hub: Hub,
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
  method: string,
  action: string,
): Promise<void> {
  const current = store.personByToken(code, readCookie(req, cookieName(code)) ?? "");
  if (method === "GET" && action === "join") return sendHtml(res, 200, joinPage(code, store.people(code), current));
  if (method === "GET" && action === "new") return sendHtml(res, 200, newNamePage(code));
  // Joining is two steps, name then PIN. The name is checked on both: the
  // second step re-reads it from the hidden field, as anyone could post it.
  if (method === "POST" && action === "new") {
    const raw = (await readForm(req)).get("name") ?? "";
    const name = normaliseName(raw);
    if (name === null) return sendHtml(res, 400, newNamePage(code, BAD_NAME, raw));
    if (store.people(code).some((p) => nameKey(p.name) === nameKey(name))) {
      return sendHtml(res, 409, newNamePage(code, NAME_TAKEN, raw));
    }
    return sendHtml(res, 200, newPinPage(code, name));
  }
  if (method === "POST" && action === "join") {
    const form = await readForm(req);
    const raw = form.get("name") ?? "";
    const outcome = store.join(code, raw, form.get("pin") ?? "");
    if (outcome.ok) {
      logAction(store.houseLabel(code), outcome.person, "join");
      // Open pages show the newcomer.
      hub.broadcast(code);
      return redirect(res, `/h/${code}`, cookieFor(req, code, outcome.token));
    }
    if (outcome.reason === "invalid_pin") return sendHtml(res, 400, newPinPage(code, normaliseName(raw) ?? raw, BAD_PIN));
    if (outcome.reason === "invalid_name") return sendHtml(res, 400, newNamePage(code, BAD_NAME, raw));
    return sendHtml(res, 409, newNamePage(code, NAME_TAKEN, raw));
  }

  // Everything below needs to know who is acting.
  const me = current;
  // A browser's EventSource can't follow a redirect to a page, so the stream
  // refuses outright instead.
  if (me === null && action === "events") throw new HttpError(403, "Join this house to see it live.");
  if (me === null) return redirect(res, `/h/${code}/join`);

  if (method === "GET" && action === "events") return hub.open(code, res);

  if (method === "GET" && action === "") {
    return sendHtml(res, 200, housePage(viewFor(store, code, me)));
  }
  if (method === "GET" && action === "history") return sendHtml(res, 200, historyPage(viewFor(store, code, me)));
  if (method === "GET" && action === "bill") return sendHtml(res, 200, billPage(viewFor(store, code, me)));
  if (method === "GET" && action === "pay") return sendHtml(res, 200, payPage(viewFor(store, code, me)));
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
      sendHtml(res, 400, billPage(viewFor(store, code, me), { ...draft, message }));
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
      return sendHtml(res, 200, billPage(viewFor(store, code, me), draft));
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
    const bill = store.addBill(code, me.id, note, shares);
    if (bill === null) throw new HttpError(400, "That bill couldn't be added.");
    logAction(store.houseLabel(code), me, "add_bill", { bill, cents: shares.reduce((sum, s) => sum + s.cents, 0) });
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "delete") {
    const id = idFrom((await readForm(req)).get("bill"));
    const outcome = id === null ? "gone" : store.deleteBill(code, id, me.id);
    // Gone already, most likely a second tap: say so over the house as it now stands.
    if (outcome === "gone") {
      return sendHtml(res, 404, housePage({ ...viewFor(store, code, me), notice: "That bill isn't here any more." }));
    }
    if (outcome === "not_yours") {
      logAction(store.houseLabel(code), me, "delete_refused", { bill: id ?? 0 });
      throw new HttpError(403, "Only the person who paid can delete a bill.");
    }
    logAction(store.houseLabel(code), me, "delete_bill", { bill: id ?? 0 });
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "pay") {
    const form = await readForm(req);
    const typed = { to: form.get("to") ?? "", amount: form.get("amount") ?? "" };
    // A mistake keeps what was typed, on the payment page.
    const again = (message: string): void => sendHtml(res, 400, payPage(viewFor(store, code, me), { ...typed, message }));
    const cents = parseCents(typed.amount);
    if (cents === null || cents === 0) return again("Type the amount in dollars, like 15.50.");
    const to = idFrom(typed.to);
    const payment = to === null ? null : store.recordPayment(code, me.id, to, cents);
    if (to === null || payment === null) return again("Pick someone else in this house.");
    logAction(store.houseLabel(code), me, "pay", { payment, to, cents });
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  if (method === "POST" && action === "dispute") {
    const id = idFrom((await readForm(req)).get("payment"));
    const outcome = id === null ? "gone" : store.disputePayment(code, id, me.id);
    if (outcome === "gone") throw new HttpError(404, "That payment isn't in this house.");
    if (outcome === "not_yours") {
      logAction(store.houseLabel(code), me, "dispute_refused", { payment: id ?? 0 });
      throw new HttpError(403, "Only the person who was paid can say it never arrived.");
    }
    // A second tap, or a second device, arrived after the first. Nothing
    // changes; the person sees the house as it now stands.
    if (outcome === "already") {
      return sendHtml(res, 409, housePage({ ...viewFor(store, code, me), notice: "That payment was already removed." }));
    }
    logAction(store.houseLabel(code), me, "dispute", { payment: id ?? 0 });
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  return notFound(res);
}

// One person's PIN page and PIN reset. Anyone with the house code can reach
// these; the PIN guards against opening someone else's name by accident.
async function person(
  store: Store,
  hub: Hub,
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
  method: string,
  action: string,
  id: number,
): Promise<void> {
  const who = store.person(code, id);
  if (who === null) return notFound(res);
  // Whoever this browser already is in this house, if anyone.
  const by = store.personByToken(code, readCookie(req, cookieName(code)) ?? "");

  if (action === "as" && method === "GET") return sendHtml(res, 200, pinPage(code, who));
  if (action === "as" && method === "POST") {
    const outcome = store.signIn(code, id, (await readForm(req)).get("pin") ?? "");
    if (!outcome.ok) {
      logAction(store.houseLabel(code), who, "wrong_pin", {}, by);
      return sendHtml(res, 401, pinPage(code, who, "That PIN isn't right. Try again."));
    }
    logAction(store.houseLabel(code), who, "sign_in", {}, by);
    return redirect(res, `/h/${code}`, cookieFor(req, code, outcome.token));
  }

  if (action === "reset" && method === "GET") return sendHtml(res, 200, resetCodePage(code, who));
  if (action === "reset" && method === "POST") {
    // Two steps: the code alone, then the code again (hidden) with the new PIN.
    const form = await readForm(req);
    const typed = form.get("code") ?? "";
    if (typedCode(typed) !== code) {
      logAction(store.houseLabel(code), who, "wrong_code", {}, by);
      return sendHtml(res, 400, resetCodePage(code, who, "That isn't this house's code. Check it and try again."));
    }
    if (!form.has("pin")) return sendHtml(res, 200, resetPinPage(code, who, typed));
    const reset = store.resetPin(code, id, form.get("pin") ?? "");
    if (reset === null) return sendHtml(res, 400, resetPinPage(code, who, typed, BAD_PIN));
    logAction(store.houseLabel(code), who, "reset_pin", {}, by);
    hub.broadcast(code);
    return redirect(res, `/h/${code}`, cookieFor(req, code, reset.token));
  }
  return notFound(res);
}
