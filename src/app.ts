import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homePage, messagePage } from "./pages.ts";
import { renderReadmePage } from "./readme.ts";
import type { Store } from "./store.ts";

const README = new URL("../README.md", import.meta.url);

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

async function route(_store: Store, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const path = parseUrl(req.url).pathname;

  if (method === "GET" && path === "/") return sendHtml(res, 200, homePage());
  if (method === "GET" && path === "/readme") return redirect(res, "/readme/");
  if (method === "GET" && path === "/readme/") {
    return sendHtml(res, 200, renderReadmePage(readFileSync(README, "utf8")));
  }
  return notFound(res);
}
