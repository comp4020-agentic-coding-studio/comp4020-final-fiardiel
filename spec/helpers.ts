import { JSDOM } from "jsdom";
import { inject } from "vitest";

// Helpers for the checks that run against the RUNNING app (spec/global-setup.ts
// finds it). Forms are posted the way a browser would, and redirects are not
// followed, so each check sees exactly what the server answered.
export const baseUrl = inject("baseUrl");

export type Form = Record<string, string>;

export function send(
  path: string,
  options: { method?: string; cookie?: string; form?: Form; body?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.cookie = options.cookie;
  let body = options.body;
  if (options.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(options.form).toString();
  }
  return fetch(new URL(path, baseUrl), {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    redirect: "manual",
    headers,
    body,
  });
}

export function post(path: string, cookie: string, form: Form): Promise<Response> {
  return send(path, { cookie, form });
}

export function cookieOf(res: Response): string {
  const cookie = res.headers.getSetCookie()[0];
  if (!cookie) throw new Error("the response set no cookie");
  return cookie.split(";")[0];
}

const parse = (html: string): Document => new JSDOM(html).window.document;
export const textOf = (html: string): string => parse(html).body.textContent ?? "";
export const buttonsOf = (html: string): string[] =>
  [...parse(html).querySelectorAll("button")].map((b) => b.textContent ?? "");
export const cookingListOf = (html: string): string[] =>
  [...parse(html).querySelectorAll("li .name")].map((n) => n.textContent ?? "");

export async function newHouse(): Promise<string> {
  const res = await send("/houses", { method: "POST" });
  const match = res.headers.get("location")?.match(/^\/h\/([23456789A-HJ-NP-Z]{6})\/join$/);
  if (res.status !== 303 || !match) throw new Error(`starting a house gave ${res.status}`);
  return match[1];
}

export async function joinAs(code: string, name: string): Promise<string> {
  const res = await send(`/h/${code}/join`, { form: { name } });
  if (res.status !== 303) throw new Error(`joining as ${JSON.stringify(name)} gave ${res.status}`);
  return cookieOf(res);
}

export async function kitchen(code: string, cookie: string): Promise<string> {
  const res = await send(`/h/${code}`, { cookie });
  if (res.status !== 200) throw new Error(`the kitchen page gave ${res.status}`);
  return res.text();
}

// Press a button the way a browser would: find the button by its label, take its
// form's action and hidden fields, and post them. Throws when the label is absent
// or ambiguous, so a renamed button fails the check.
export async function press(html: string, label: string, cookie: string): Promise<Response> {
  const doc = parse(html);
  const forms = [...doc.querySelectorAll("form")].filter(
    (f) => f.querySelector("button")?.textContent === label,
  );
  if (forms.length !== 1) throw new Error(`expected one button labelled ${JSON.stringify(label)}, found ${forms.length}`);
  const form = forms[0];
  const fields: Form = {};
  for (const input of form.querySelectorAll<HTMLInputElement>("input[name]")) fields[input.name] = input.value;
  return send(form.getAttribute("action") ?? "", { cookie, form: fields });
}

// The id behind a name, read off the join page's "that's me" buttons.
export async function personIdOf(code: string, name: string): Promise<string> {
  const doc = parse(await (await send(`/h/${code}/join`)).text());
  for (const form of doc.querySelectorAll("form")) {
    const id = form.querySelector<HTMLInputElement>('input[name="person"]')?.value;
    if (id !== undefined && form.querySelector("button")?.textContent === name) return id;
  }
  throw new Error(`${name} is not listed on the join page of ${code}`);
}
