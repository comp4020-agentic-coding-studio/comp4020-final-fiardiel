import { formatCents } from "./money.ts";
import { NAME_MAX, NOTE_MAX } from "./names.ts";
import type { Person } from "./store.ts";

export type Draft = { note: string; total: string; amounts: Record<number, string>; ticked: number[]; message?: string };

export type Entry =
  | { kind: "bill"; id: number; paidBy: Person; note: string; shares: { person: Person; cents: number }[]; mine: boolean }
  | { kind: "payment"; id: number; from: Person; to: Person; cents: number; toMe: boolean };

export type HouseView = {
  code: string;
  me: Person;
  people: Person[];
  // Non-zero only, in name order. Positive: they owe me. Negative: I owe them.
  balances: { person: Person; cents: number }[];
  history: Entry[];
  draft?: Draft;
  // Said once, above everything, e.g. when a tap arrived after someone else's.
  notice?: string;
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Everything another person typed goes through this before it reaches a page.
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Notebook look: paper off-white, a serif title, thin ruled lines and one
// sage accent. Balances are large so they read at arm's length, but owing and
// being owed are styled the same: no red, nothing that marks a debtor.
const STYLE = `
  :root {
    color-scheme: light dark;
    --paper: #faf7f2; --card: #fffdf9; --ink: #2f2a24; --muted: #7d7468;
    --rule: #e3dccf; --accent: #5f7a5a; --on-accent: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #1d1b18; --card: #25221e; --ink: #ece6dc; --muted: #a59c8f;
      --rule: #3a352e; --accent: #93b28c; --on-accent: #14130f;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
  h1 { font: 400 2rem/1.2 Georgia, "Times New Roman", serif; margin: 0.5rem 0 1rem; }
  h2 { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 1.75rem 0 0.5rem; }
  a { color: var(--accent); }
  .quiet { color: var(--muted); font-size: 0.875rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  #balances li { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid var(--rule); font-size: 1.1rem; }
  #balances li:first-child { border-top: 1px solid var(--rule); }
  #balances .amount { font-size: 1.85rem; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  p#balances { margin: 0; padding: 0.75rem 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); font-size: 1.2rem; }
  #history li { padding: 0.5rem 0; border-bottom: 1px solid var(--rule); color: var(--muted); font-size: 0.9rem; }
  p#history { color: var(--muted); font-size: 0.9rem; }

  form { margin: 0.5rem 0; }
  form.card { background: var(--card); border: 1px solid var(--rule); border-radius: 14px; padding: 1rem; }
  label { display: block; margin: 0.25rem 0; }
  input, select, button { font: inherit; min-height: 2.75rem; border-radius: 10px; }
  input, select { width: 100%; padding: 0 0.75rem; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  input[type="checkbox"] { width: 1.25rem; min-height: 1.25rem; margin: 0; accent-color: var(--accent); }
  button { border: 0; padding: 0 1.25rem; background: var(--accent); color: var(--on-accent); font-weight: 600; cursor: pointer; }
  button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }
  /* "Add bill" comes first in the page so Enter adds the bill, but it shows
     last, after "Split equally", in the order people use them. */
  form.card { display: flex; flex-direction: column; }
  form.card > button { order: 1; width: 100%; margin-top: 0.75rem; }
  li form { display: inline; margin: 0 0 0 0.25rem; }
  li form button { min-height: 2.75rem; padding: 0 0.5rem; background: none; color: var(--accent); font-weight: 500; text-decoration: underline; }

  fieldset { border: 0; padding: 0; margin: 0.75rem 0 0; }
  legend { font-size: 0.875rem; color: var(--muted); margin-bottom: 0.25rem; }
  .row { display: grid; grid-template-columns: 1fr 7rem; align-items: center; gap: 0.75rem; margin: 0; padding: 0.35rem 0; border-bottom: 1px solid var(--rule); }
  .row label { display: flex; align-items: center; gap: 0.6rem; margin: 0; }
  .row input:not([type="checkbox"]), .split input { text-align: right; }
  .split { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 0.5rem; margin: 0.75rem 0 0; }
  .split label { margin: 0; font-size: 0.875rem; color: var(--muted); }
  [role="alert"], [role="status"] { margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: var(--card); border-left: 3px solid var(--accent); border-radius: 6px; }
`;

export function layout(title: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <style>${STYLE}</style>
  </head>
  <body>
    <main>
${body}
      <p class="quiet"><a href="/readme/">About this app</a></p>
    </main>
    ${script === "" ? "" : `<script>${script}</script>`}
  </body>
</html>
`;
}

function postForm(action: string, fields: Record<string, string>, label: string, cls = ""): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`)
    .join("");
  const klass = cls === "" ? "" : ` class="${esc(cls)}"`;
  return `<form method="post" action="${esc(action)}">${hidden}<button type="submit"${klass}>${esc(label)}</button></form>`;
}

const alertLine = (message?: string): string => (message ? `<p role="alert">${esc(message)}</p>` : "");

export function homePage(message?: string, mine: { code: string; name: string }[] = []): string {
  const houses =
    mine.length === 0
      ? ""
      : `
      <h2>Your houses</h2>
      <ul>${mine.map((h) => `<li><a href="/h/${esc(h.code)}">${esc(h.code)}</a> as <strong>${esc(h.name)}</strong></li>`).join("")}</ul>`;
  return layout(
    "Serumah",
    `      <h1>Serumah</h1>
      <p>Split your house's bills and see who owes whom.</p>
      <p class="quiet">Based on Serumah, the Telegram bot by <a href="https://github.com/davinpwk">davinpwk</a>.</p>
      ${alertLine(message)}${houses}
      <form method="post" action="/houses">
        <button type="submit">Start a new house</button>
      </form>
      <form method="get" action="/join">
        <label>House code <input name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" /></label>
        <button type="submit">Join</button>
      </form>`,
  );
}

export function joinPage(code: string, people: Person[], message?: string, current: Person | null = null): string {
  const already =
    current === null
      ? ""
      : `
      <p>You're already in this house as <strong>${esc(current.name)}</strong>. <a href="/h/${esc(code)}">Go to your house</a></p>`;
  const claims =
    people.length === 0
      ? ""
      : `
      <h2>Already here? That's me</h2>
      ${people.map((p) => postForm(`/h/${code}/claim`, { person: String(p.id) }, p.name, "secondary")).join("\n      ")}`;
  return layout(
    "Join",
    `      <h1>Join house ${esc(code)}</h1>
      <p>Share this code with your housemates: <strong>${esc(code)}</strong></p>${already}
      ${alertLine(message)}
      <form method="post" action="/h/${esc(code)}/join">
        <label>Your name <input name="name" required maxlength="${NAME_MAX}" autocomplete="off" /></label>
        <button type="submit">Join</button>
      </form>${claims}`,
  );
}

// Live updates: the server says "changed" on this house's event stream, and
// the page fetches itself again and swaps in the new #live section. The forms
// sit outside #live, so a half-typed bill is never wiped. The page also
// re-fetches whenever the stream (re)opens, so someone coming back, or whose
// connection dropped, sees the current state. Without script, every form still
// works; only the live updates are lost.
const LIVE_SCRIPT = `
  let live = document.getElementById("live");
  const base = live.dataset.base;
  async function refresh() {
    const res = await fetch(base, { cache: "no-store" });
    if (!res.ok) return;
    const page = new DOMParser().parseFromString(await res.text(), "text/html");
    const next = page.getElementById("live");
    if (!next) return;
    const joined = next.dataset.people !== live.dataset.people;
    live.replaceWith(next);
    live = next;
    // Someone joined: the forms need them too. Forms nobody has typed in are
    // swapped for fresh ones; otherwise what was typed stays and a note asks
    // for a reload once it's sent.
    if (joined) {
      const forms = document.getElementById("forms");
      if (untouched(forms)) forms.replaceWith(page.getElementById("forms"));
      else document.getElementById("stale").hidden = false;
    }
  }
  function untouched(forms) {
    for (const input of forms.querySelectorAll("input")) {
      if (input.type === "checkbox" ? !input.checked : input.type !== "hidden" && input.value !== "") return false;
    }
    return true;
  }
  // The browser retries a dropped stream by itself, but gives up for good when
  // a retry gets an error page (a deploy, a restart). Then a new stream is
  // started, waiting a little longer each time.
  let wait = 2000;
  function connect() {
    const events = new EventSource(base + "/events");
    events.addEventListener("changed", () => refresh().catch(() => {}));
    events.addEventListener("open", () => {
      wait = 2000;
      refresh().catch(() => {});
    });
    events.addEventListener("error", () => {
      if (events.readyState !== EventSource.CLOSED) return;
      setTimeout(connect, wait);
      wait = Math.min(wait * 2, 60000);
    });
  }
  connect();
`;

function balanceLine(b: { person: Person; cents: number }): string {
  const name = `<span class="name">${esc(b.person.name)}</span>`;
  const who = b.cents > 0 ? `${name} owes you` : `You owe ${name}`;
  return `<li><span class="who">${who}</span> <span class="amount">${formatCents(Math.abs(b.cents))}</span></li>`;
}

function entryLine(entry: Entry, base: string): string {
  if (entry.kind === "payment") {
    // Only the receiver can see whether the money arrived, so only they can say it didn't.
    const dispute = entry.toMe ? postForm(`${base}/dispute`, { payment: String(entry.id) }, "Didn't get it") : "";
    return `<li>${esc(entry.from.name)} paid ${esc(entry.to.name)} ${formatCents(entry.cents)}${dispute}</li>`;
  }
  const total = entry.shares.reduce((sum, s) => sum + s.cents, 0);
  const what = entry.note === "" ? "a bill" : esc(entry.note);
  const shares = entry.shares.map((s) => `${esc(s.person.name)} ${formatCents(s.cents)}`).join(", ");
  const remove = entry.mine ? postForm(`${base}/delete`, { bill: String(entry.id) }, "Delete") : "";
  return `<li>${esc(entry.paidBy.name)} paid ${formatCents(total)} for ${what}: ${shares}${remove}</li>`;
}

export function housePage(view: HouseView): string {
  const base = `/h/${view.code}`;
  const draft = view.draft ?? { note: "", total: "", amounts: {}, ticked: view.people.map((p) => p.id) };

  const balances =
    view.balances.length === 0
      ? `<p id="balances">Nobody owes anybody.</p>`
      : `<ul id="balances">${view.balances.map(balanceLine).join("")}</ul>`;
  const history =
    view.history.length === 0
      ? `<p id="history">No bills yet.</p>`
      : `<ul id="history">${view.history.map((e) => entryLine(e, base)).join("")}</ul>`;

  const rows = view.people
    .map(
      (p) =>
        `<p class="row"><label><input type="checkbox" name="with_${p.id}"${draft.ticked.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label> <input name="amount_${p.id}" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.amounts[p.id] ?? "")}" aria-label="${esc(p.name)}'s amount" /></p>`,
    )
    .join("\n          ");
  const others = view.people.filter((p) => p.id !== view.me.id);
  const payForm =
    others.length === 0
      ? `<p class="quiet">Nobody else is in the house yet. Share the code <strong>${esc(view.code)}</strong>.</p>`
      : `<form class="card" method="post" action="${esc(base)}/pay">
        <label>To <select name="to">${others.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></label>
        <label>Amount <input name="amount" inputmode="decimal" size="8" required autocomplete="off" /></label>
        <button type="submit">I paid this</button>
      </form>`;

  // "Add bill" comes first so pressing Enter in a box adds the bill rather
  // than refilling the form.
  return layout(
    "Serumah",
    `      <h1>Serumah</h1>
      <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong> · <a href="${esc(base)}/join">Not you?</a></p>
      ${view.notice ? `<p role="status">${esc(view.notice)}</p>` : ""}
      <section id="live" data-base="${esc(base)}" data-people="${view.people.map((p) => p.id).join(",")}">
        <h2>Balances</h2>
        ${balances}
        <h2>History</h2>
        ${history}
      </section>
      <section id="forms">
      <p id="stale" role="status" hidden>Someone new joined the house. Once you've sent this, reload to include them.</p>
      <h2>Add a bill you paid</h2>
      <form class="card" method="post" action="${esc(base)}/bill">
        ${alertLine(draft.message)}
        <label>What for <input name="note" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(draft.note)}" /></label>
        <fieldset>
          <legend>Who owes what (in dollars)</legend>
          ${rows}
        </fieldset>
        <button type="submit" name="intent" value="add">Add bill</button>
        <p class="split"><label>Or split a total equally between the ticked people <input name="total" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.total)}" /></label>
        <button type="submit" name="intent" value="fill" class="secondary">Split equally</button></p>
      </form>
      <h2>Record a payment you made</h2>
      ${payForm}
      </section>`,
    LIVE_SCRIPT,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `      <h1>${esc(title)}</h1>\n      <p>${esc(message)}</p>\n      <p><a href="/">Home</a></p>`);
}
