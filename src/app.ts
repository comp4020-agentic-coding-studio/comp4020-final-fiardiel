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

const README = new URL("../README.md", import.meta.url);
const CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;
const MAX_BODY = 4096;
const NO_SUCH_HOUSE = "There's no house with that code. Check it and try again.";

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
    dated.push({
      at: b.at,
      entry: { kind: "bill", id: b.id, paidBy: who(b.paidBy), note: b.note, shares, mine: b.paidBy === me.id },
    });
  }
  // A payment the receiver said they didn't get is gone from the page.
  for (const p of payments) {
    if (p.status === "rejected") continue;
    dated.push({
      at: p.at,
      entry: { kind: "payment", from: who(p.fromId), to: who(p.toId), cents: p.cents, pending: p.status === "pending" },
    });
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
  if (method === "POST" && path === "/houses") return redirect(res, `/h/${store.createHouse()}/join`);
  if (method === "GET" && path === "/join") {
    const code = (url.searchParams.get("code") ?? "").replace(/\s+/g, "").toUpperCase();
    if (CODE_RE.test(code) && store.houseExists(code)) return redirect(res, `/h/${code}/join`);
    return sendHtml(res, 404, homePage(NO_SUCH_HOUSE, myHouses(store, req)));
  }

  const match = path.match(/^\/h\/([^/]+)(?:\/([a-z]+))?\/?$/);
  if (match === null) return notFound(res);
  const [, code, action = ""] = match;
  // The home form upper-cases what people type, so a lower-case code in an address
  // is sent to the upper-case one. Only reading is redirected: a POST stays a 404.
  const upper = code.toUpperCase();
  if (method === "GET" && code !== upper && CODE_RE.test(upper)) {
    return redirect(res, action === "" ? `/h/${upper}` : `/h/${upper}/${action}`);
  }
  if (!CODE_RE.test(code) || !store.houseExists(code)) {
    return sendHtml(res, 404, messagePage("No such house", NO_SUCH_HOUSE));
  }
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
  if (method === "GET" && action === "join") {
    return sendHtml(res, 200, joinPage(code, store.people(code), undefined, current));
  }
  if (method === "POST" && action === "join") {
    const outcome = store.join(code, (await readForm(req)).get("name") ?? "");
    if (outcome.ok) return redirect(res, `/h/${code}`, cookieFor(req, code, outcome.token));
    if (outcome.reason === "invalid_name") {
      const message = `Pick a name of 1 to ${NAME_MAX} characters, without control characters.`;
      return sendHtml(res, 400, joinPage(code, store.people(code), message, current));
    }
    const taken = "That name is taken. If it's you, tap it below, or pick another.";
    return sendHtml(res, 409, joinPage(code, store.people(code), taken, current));
  }
  if (method === "POST" && action === "claim") {
    const id = Number((await readForm(req)).get("person"));
    const claimed = Number.isInteger(id) ? store.claim(code, id) : null;
    if (claimed === null) throw new HttpError(400, "That name isn't in this house.");
    return redirect(res, `/h/${code}`, cookieFor(req, code, claimed.token));
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
    if (outcome === "already") {
      throw new HttpError(409, "That payment was already answered. Go back to your house to see how things stand.");
    }
    hub.broadcast(code);
    return redirect(res, `/h/${code}`);
  }
  return notFound(res);
}
