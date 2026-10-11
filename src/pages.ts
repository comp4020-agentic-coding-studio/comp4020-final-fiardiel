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

// Ink-blue notebook: warm paper, a serif title, rounded cards, ink blue with
// terracotta as a second colour. Balances are large so they read at arm's
// length. What you owe and what you're owed sit in separate cards but look
// the same: one colour, no red, nothing that marks a debtor. Each housemate
// has a coloured initial only so people can be told apart at a glance.
const STYLE = `
  :root {
    color-scheme: light dark;
    --paper: #f8f6f2; --card: #ffffff; --ink: #1f2430; --muted: #6f7684;
    --rule: #e6e3dd; --accent: #2f4fa2; --accent-2: #c8734a; --strip: #e6ebf7; --on-accent: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #13161f; --card: #1d2230; --ink: #e8ebf5; --muted: #9aa2b5;
      --rule: #2c3346; --accent: #8aa6ff; --accent-2: #ef9a70; --strip: #1d2847; --on-accent: #13161f;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
  h1 { font: 700 2rem/1.15 Georgia, "Times New Roman", serif; margin: 0.25rem 0 0.75rem; }
  h2 { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 1.5rem 0 0.5rem; }
  a { color: var(--accent); }
  .quiet { color: var(--muted); font-size: 0.875rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: 0; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; column-gap: 1rem; }
  .top p { margin: 0 0 0.75rem; }

  #totals { display: flex; justify-content: space-between; gap: 1rem; margin: 0.5rem 0 0; padding: 0.9rem 1.1rem; background: var(--strip); border-radius: 16px; }
  #totals > div:last-child { text-align: right; }
  #totals .label { display: block; font-size: 0.8rem; color: var(--muted); }
  #totals .total { display: block; font-size: 1.9rem; font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; line-height: 1.2; }
  p#balances { margin: 0.5rem 0 0; padding: 1rem 1.1rem; background: var(--strip); border-radius: 16px; font-size: 1.2rem; font-weight: 600; }

  .pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; margin-top: 0.75rem; }
  .box { background: var(--card); border: 1px solid var(--rule); border-radius: 16px; padding: 0.25rem 1rem 0.75rem; }
  .box h2 { margin: 0.75rem 0 0.25rem; }
  .box p.quiet { margin: 0.5rem 0 0.25rem; }

  #owed li, #owing li { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0; border-top: 1px solid var(--rule); }
  .avatar { flex: none; width: 2rem; height: 2rem; border-radius: 50%; background: var(--av); display: inline-flex; align-items: center; justify-content: center; }
  .avatar::before { content: attr(data-initial); color: #fff; font-weight: 700; font-size: 0.9rem; }
  .who { flex: 1; min-width: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
  .amount { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }

  #bills li, #payments li { padding: 0.55rem 0; border-top: 1px solid var(--rule); font-size: 0.9rem; }
  #bills li::before, #payments li::before { display: inline-block; margin-right: 0.4rem; padding: 0 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; line-height: 1.5; color: var(--on-accent); }
  #bills li::before { content: "bill"; background: var(--accent-2); }
  #payments li::before { content: "paid"; background: var(--accent); }
  #bills .shares { display: block; color: var(--muted); }
  p#history { color: var(--muted); }

  form { margin: 0.5rem 0; }
  form.card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--rule); border-radius: 16px; padding: 1rem; }
  label { display: block; margin: 0.25rem 0; }
  input, select, button { font: inherit; min-height: 2.75rem; border-radius: 12px; }
  input, select { width: 100%; padding: 0 0.75rem; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  input[type="checkbox"] { width: 1.25rem; min-height: 1.25rem; margin: 0; accent-color: var(--accent); }
  button { border: 0; padding: 0 1.25rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; cursor: pointer; }
  button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }
  /* "Add bill" comes first in the page so Enter adds the bill, but it shows
     last, after "Split equally", in the order people use them. */
  form.card > button { order: 1; width: 100%; margin-top: 0.75rem; }
  li form { display: inline; margin: 0 0 0 0.25rem; }
  li form button { min-height: 2.75rem; padding: 0 0.4rem; background: none; color: var(--accent); font-weight: 600; text-decoration: underline; }

  fieldset { border: 0; padding: 0; margin: 0.75rem 0 0; }
  legend { font-size: 0.875rem; color: var(--muted); margin-bottom: 0.25rem; }
  .row { display: grid; grid-template-columns: 1fr 7rem; align-items: center; gap: 0.75rem; margin: 0; padding: 0.35rem 0; border-bottom: 1px solid var(--rule); }
  .row label { display: flex; align-items: center; gap: 0.6rem; margin: 0; }
  .row input:not([type="checkbox"]), .split input { text-align: right; }
  .split { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 0.5rem; margin: 0.75rem 0 0; }
  .split label { margin: 0; font-size: 0.875rem; color: var(--muted); }
  [role="alert"], [role="status"] { margin: 0.5rem 0; padding: 0.5rem 0.75rem; background: var(--card); border-left: 3px solid var(--accent); border-radius: 8px; }

  /* Side by side once there is room; stacked on phones. */
  @media (min-width: 44rem) {
    main { max-width: 52rem; }
    .pair { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  }
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

// A fixed colour per housemate, so the same person always looks the same.
const AVATARS = ["#e8946a", "#5aa0d8", "#6fbf8f", "#b48ad6", "#e0b84f", "#e07a9b"];

// The initial is drawn by CSS from data-initial, so it adds no text to the row.
function avatar(person: Person): string {
  const initial = [...person.name][0] ?? "";
  return `<span class="avatar" data-initial="${esc(initial)}" style="--av: ${AVATARS[person.id % AVATARS.length]}"></span>`;
}

// The card's title already says which way the money goes, so the words that
// repeat it are kept for screen readers (and the row's text) but not shown.
function balanceLine(b: { person: Person; cents: number }): string {
  const name = `<span class="name">${esc(b.person.name)}</span>`;
  const who = b.cents > 0 ? `${name}<span class="sr"> owes you</span>` : `<span class="sr">You owe </span>${name}`;
  return `<li>${avatar(b.person)}<span class="who">${who}</span> <span class="amount">${formatCents(Math.abs(b.cents))}</span></li>`;
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
  return `<li>${esc(entry.paidBy.name)} paid ${formatCents(total)} for ${what}:<span class="shares"> ${shares}</span>${remove}</li>`;
}

export function housePage(view: HouseView): string {
  const base = `/h/${view.code}`;
  const draft = view.draft ?? { note: "", total: "", amounts: {}, ticked: view.people.map((p) => p.id) };

  const owed = view.balances.filter((b) => b.cents > 0);
  const owing = view.balances.filter((b) => b.cents < 0);
  const sum = (list: { cents: number }[]): number => list.reduce((total, b) => total + Math.abs(b.cents), 0);
  const list = (id: string, items: string[], empty: string): string =>
    items.length === 0 ? `<p class="quiet">${empty}</p>` : `<ul id="${id}">${items.join("")}</ul>`;
  const balances =
    view.balances.length === 0
      ? `<p id="balances">Nobody owes anybody.</p>`
      : `<div id="totals"><div><span class="label">Owed to you</span> <span class="total">${formatCents(sum(owed))}</span></div><div><span class="label">You owe</span> <span class="total">${formatCents(sum(owing))}</span></div></div>
        <div id="balances" class="pair">
          <section class="box"><h2>Owed to you</h2>${list("owed", owed.map(balanceLine), "Nobody owes you.")}</section>
          <section class="box"><h2>You owe</h2>${list("owing", owing.map(balanceLine), "You don't owe anybody.")}</section>
        </div>`;
  const bills = view.history.filter((e) => e.kind === "bill");
  const payments = view.history.filter((e) => e.kind === "payment");
  const history =
    view.history.length === 0
      ? `<p id="history">No bills yet.</p>`
      : `<div id="history" class="pair">
          <section class="box"><h2>Bills</h2>${list("bills", bills.map((e) => entryLine(e, base)), "No bills yet.")}</section>
          <section class="box"><h2>Payments</h2>${list("payments", payments.map((e) => entryLine(e, base)), "No payments yet.")}</section>
        </div>`;

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
    `      <header class="top">
        <h1>Serumah</h1>
        <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong> · <a href="${esc(base)}/join">Not you?</a></p>
      </header>
      ${view.notice ? `<p role="status">${esc(view.notice)}</p>` : ""}
      <section id="live" data-base="${esc(base)}" data-people="${view.people.map((p) => p.id).join(",")}">
        ${balances}
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
