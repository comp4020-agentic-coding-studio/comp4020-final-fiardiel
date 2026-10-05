import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { NAME_MAX } from "./names.ts";
import { handoffPage, homePage, joinPage, kitchenPage, messagePage } from "./pages.ts";
import type { KitchenView } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import { cookingNow, kitchenState, lastCooked, responsible } from "./rules.ts";
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

function viewFor(store: Store, code: string, me: Person): KitchenView {
  const history = store.history(code);
  const people = new Map<number, Person>(store.people(code).map((p) => [p.id, p] as const));
  const named = (id: number | null): Person | null => (id === null ? null : (people.get(id) ?? null));
  const cooking = cookingNow(history.sessions);
  return {
    code,
    me,
    cooking: cooking.map((id) => people.get(id)).filter((p): p is Person => p !== undefined),
    state: kitchenState(history.marks),
    responsible: named(responsible(history.sessions, history.marks)),
    lastCooked: named(lastCooked(history.sessions)),
    iAmCooking: cooking.includes(me.id),
  };
}

export function createHandler(store: Store) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(store, req, res);
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

async function route(store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  if (!CODE_RE.test(code) || !store.houseExists(code)) {
    return sendHtml(res, 404, messagePage("No such house", NO_SUCH_HOUSE));
  }
  return house(store, req, res, code, method, action);
}

async function house(
  store: Store,
  req: IncomingMessage,
  res: ServerResponse,
  code: string,
  method: string,
  action: string,
): Promise<void> {
  if (method === "GET" && action === "join") {
    const current = store.personByToken(code, readCookie(req, cookieName(code)) ?? "");
    return sendHtml(res, 200, joinPage(code, store.people(code), undefined, current));
  }
  if (method === "POST" && action === "join") {
    const outcome = store.join(code, (await readForm(req)).get("name") ?? "");
    if (outcome.ok) return redirect(res, `/h/${code}`, cookieFor(req, code, outcome.token));
    if (outcome.reason === "invalid_name") {
      const message = `Pick a name of 1 to ${NAME_MAX} characters, without control characters.`;
      return sendHtml(res, 400, joinPage(code, store.people(code), message));
    }
    const taken = "That name is taken. If it's you, tap it below, or pick another.";
    return sendHtml(res, 409, joinPage(code, store.people(code), taken));
  }
  if (method === "POST" && action === "claim") {
    const id = Number((await readForm(req)).get("person"));
    const claimed = Number.isInteger(id) ? store.claim(code, id) : null;
    if (claimed === null) throw new HttpError(400, "That name isn't in this house.");
    return redirect(res, `/h/${code}`, cookieFor(req, code, claimed.token));
  }

  // Everything below needs to know who is acting.
  const me = store.personByToken(code, readCookie(req, cookieName(code)) ?? "");
  if (me === null) return redirect(res, `/h/${code}/join`);

  if (method === "GET" && action === "") {
    return sendHtml(res, 200, kitchenPage(viewFor(store, code, me)));
  }
  if (method === "GET" && action === "handoff") {
    return sendHtml(res, 200, handoffPage(code));
  }
  if (method === "POST" && action === "cook") {
    const form = await readForm(req);
    const choice = form.get("action");
    if (choice === "start") {
      store.startCooking(code, me.id);
      return redirect(res, `/h/${code}`);
    }
    if (choice === "stop") {
      store.stopCooking(code, me.id);
      return redirect(res, `/h/${code}/handoff`);
    }
    if (choice === "end") {
      // Anyone in the house can end a session someone forgot. Only that
      // person's open session in this house can end, so a stray id ends nothing.
      const id = Number(form.get("person") ?? "");
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "That person isn't in this house.");
      store.stopCooking(code, id);
      return redirect(res, `/h/${code}`);
    }
    throw new HttpError(400, "Choose start, stop or end.");
  }
  if (method === "POST" && action === "mark") {
    const state = (await readForm(req)).get("state");
    if (state !== "clean" && state !== "messy") throw new HttpError(400, "Choose clean or messy.");
    store.mark(code, me.id, state);
    return redirect(res, `/h/${code}`);
  }
  return notFound(res);
}
