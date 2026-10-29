import { formatCents } from "./money.ts";
import type { Person } from "./store.ts";

type Details = Record<string, string | number>;

// One plain sentence per event, read out at the crit: which house, who, what.
// Names are JSON-quoted, so a name with quotes or a newline can't break the
// line or pass for another sentence. The house is its log label, never its
// code, and a PIN is never passed in. `by` is the browser's own person (or
// nobody) when it acts on someone else's name.
export function logLine(house: string, person: Person | null, action: string, details: Details = {}, by?: Person | null): string {
  const who = (p: Person | null): string => (p === null ? "someone not signed in" : `${JSON.stringify(p.name)} (#${p.id})`);
  const pages = (n: string | number | undefined): string => `${n} ${n === 1 ? "page" : "pages"}`;
  const from = by === undefined ? "" : by === null ? ", from a new browser" : `, from ${who(by)}'s browser`;
  const d = details;
  const money = (): string => formatCents(Number(d.cents));
  const sentences: Record<string, () => string> = {
    create_house: () => "a new house was started",
    join: () => `${who(person)} joined`,
    sign_in: () => `${who(person)} signed in with their PIN${from}`,
    wrong_pin: () => `REFUSED wrong PIN for ${who(person)}${from}`,
    wrong_code: () => `REFUSED wrong house code when resetting ${who(person)}'s PIN${from}`,
    reset_pin: () => `${who(person)} had their PIN reset${from}`,
    add_bill: () => `${who(person)} added bill #${d.bill} for ${money()}`,
    read_receipt: () => `${who(person)} read a receipt for ${money()} (${d.items} items); nothing is added until they tap Add bill`,
    delete_bill: () => `${who(person)} deleted bill #${d.bill}`,
    delete_refused: () => `REFUSED ${who(person)}: can't delete bill #${d.bill}, someone else paid it`,
    pay: () => `${who(person)} paid ${JSON.stringify(String(d.to))} ${money()} (payment #${d.payment})`,
    dispute: () => `${who(person)} said payment #${d.payment} never arrived`,
    dispute_refused: () => `REFUSED ${who(person)}: can't dispute payment #${d.payment}, it wasn't paid to them`,
    connect: () => `${who(person)} opened the house page (${pages(d.clients)} open)`,
    disconnect: () => `${who(person)} left the house page (${pages(d.clients)} still open)`,
    broadcast: () => `told ${d.clients} open ${d.clients === 1 ? "page" : "pages"} to refresh`,
    snapshot: () => `${who(person)} was sent the latest ${d.page === "history" ? "history" : "house"}`,
    rejected: () => `REFUSED ${who(person)}: ${String(d.reason)} (${d.status})`,
  };
  return `[${house}] ${sentences[action]?.() ?? `${who(person)} ${action}`}`;
}

export function logAction(...args: Parameters<typeof logLine>): void {
  console.log(logLine(...args));
}
