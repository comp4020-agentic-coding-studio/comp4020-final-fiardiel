import type { Person } from "./store.ts";

// One line per action, so the server log says which house, who, and what.
// Strings are JSON-quoted: a name with quotes or a newline can't break the
// line or pass for another field. A PIN or typed house code is never passed in.
// `by` is the device's own person (or nobody) when it acts on someone else's
// name, so a sign-in or PIN reset done from another housemate's browser shows.
export function logLine(
  code: string,
  person: Person | null,
  action: string,
  details: Record<string, string | number> = {},
  by?: Person | null,
): string {
  const name = (p: Person | null): string => (p === null ? "-" : `${JSON.stringify(p.name)}#${p.id}`);
  const rest = Object.entries(details).map(([k, v]) => ` ${k}=${typeof v === "number" ? v : JSON.stringify(v)}`);
  const device = by === undefined ? "" : ` by=${name(by)}`;
  return `house=${code} person=${name(person)} action=${action}${rest.join("")}${device}`;
}

export function logAction(...args: Parameters<typeof logLine>): void {
  console.log(logLine(...args));
}
