import type { Person } from "./store.ts";

// One line per action, so the server log says which house, who, and what.
// Strings are JSON-quoted: a name with quotes or a newline can't break the
// line or pass for another field. A PIN or typed house code is never passed in.
export function logLine(
  code: string,
  person: Person | null,
  action: string,
  details: Record<string, string | number> = {},
): string {
  const who = person === null ? "-" : `${JSON.stringify(person.name)}#${person.id}`;
  const rest = Object.entries(details).map(([k, v]) => ` ${k}=${typeof v === "number" ? v : JSON.stringify(v)}`);
  return `house=${code} person=${who} action=${action}${rest.join("")}`;
}

export function logAction(...args: Parameters<typeof logLine>): void {
  console.log(logLine(...args));
}
