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

// Ink-blue notebook: warm paper, a serif title, rounded cards. On amounts,
// colour means the direction of money: ink blue for what you're owed,
// terracotta for what you owe. Both sides have the same size and weight, and
// neither is red or green, so nobody is marked. The history pills say the kind
// of entry instead, in two colours kept clear of both directions: mustard for
// a bill, plum for a payment. Buttons stay neutral. Each housemate has a
// coloured initial so people are easy to tell apart at a glance.
const STYLE = `
  :root {
    color-scheme: light dark;
    --paper: #f8f6f2; --card: #ffffff; --ink: #1f2430; --muted: #6f7684;
    --rule: #e6e3dd; --accent: #2f4fa2; --on-accent: #ffffff; --pill: #eceae5;
    --owed: #2f4fa2; --owe: #b8643e; --strip-owed: #e6ebf7; --strip-owe: #f8e9e1;
    --bill-bg: #f5e9c4; --bill-ink: #74570d; --paid-bg: #ebdcf3; --paid-ink: #6b3d84;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #13161f; --card: #1d2230; --ink: #e8ebf5; --muted: #9aa2b5;
      --rule: #2c3346; --accent: #8aa6ff; --on-accent: #13161f; --pill: #2a3142;
      --owed: #8aa6ff; --owe: #ef9a70; --strip-owed: #1d2847; --strip-owe: #3a2620;
      --bill-bg: #3a3118; --bill-ink: #e6c766; --paid-bg: #33263e; --paid-ink: #d2abe8;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1.25rem 1rem 2.5rem; }
  h1 { font: 700 2rem/1.15 Georgia, "Times New Roman", serif; margin: 0.25rem 0 0.75rem; }
  h2 { font-size: 0.95rem; font-weight: 650; margin: 1.5rem 0 0.5rem; }
  a { color: var(--accent); }
  .quiet { color: var(--muted); font-size: 0.875rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: 0; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; column-gap: 1rem; }
  .top p { margin: 0 0 0.75rem; }

  #totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.5rem; margin: 0.5rem 0 0; }
  #totals > div { padding: 0.8rem 1rem; border-radius: 16px; }
  #totals .owed { background: var(--strip-owed); }
  #totals .owe { background: var(--strip-owe); text-align: right; }
  #totals .label { display: block; font-size: 0.8rem; color: var(--muted); }
  #totals .total { display: block; font-size: 1.75rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.2; }
  #totals .owed .total { color: var(--owed); }
  #totals .owe .total { color: var(--owe); }
  p#balances { margin: 0.5rem 0 0; padding: 1rem 1.1rem; background: var(--strip-owed); border-radius: 16px; font-size: 1.2rem; font-weight: 600; }

  .pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; margin-top: 0.75rem; }
  .box { background: var(--card); border: 1px solid var(--rule); border-radius: 16px; padding: 0.25rem 1rem 0.75rem; }
  .box h2 { margin: 0.75rem 0 0.4rem; }
  .box p.quiet { margin: 0.5rem 0 0.25rem; }
  #live > .box { margin-top: 0.75rem; }

  #owed li, #owing li { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0; border-top: 1px solid var(--rule); }
  .avatar { flex: none; width: 2rem; height: 2rem; border-radius: 50%; background: var(--av); display: inline-flex; align-items: center; justify-content: center; }
  .avatar::before { content: attr(data-initial); color: #fff; font-weight: 700; font-size: 0.9rem; }
  .who { flex: 1; min-width: 0; font-size: 1.05rem; overflow-wrap: anywhere; }
  .amount { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  #owed .amount { color: var(--owed); }
  #owing .amount { color: var(--owe); }
  .avatar.small { width: 1.25rem; height: 1.25rem; }
  .avatar.small::before { font-size: 0.65rem; }

  /* History rows read like small receipts: what and how much first, then who
     paid, then one chip per share, coloured by which way the money goes. */
  #history > li { padding: 0.75rem 0; border-top: 1px solid var(--rule); }
  .line { display: flex; align-items: baseline; gap: 0.5rem; }
  .pill { flex: none; padding: 0.05rem 0.55rem; border-radius: 999px; background: var(--pill); color: var(--muted); font-size: 0.72rem; font-weight: 700; }
  .pill.bill { background: var(--bill-bg); color: var(--bill-ink); }
  .pill.paid { background: var(--paid-bg); color: var(--paid-ink); }
  .what { flex: 1; min-width: 0; font-size: 1.05rem; font-weight: 650; overflow-wrap: anywhere; }
  .line .total { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .by { display: flex; align-items: center; gap: 0.4rem; margin: 0.3rem 0 0.5rem; color: var(--muted); font-size: 0.85rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.15rem 0.6rem 0.15rem 0.2rem; border: 1px solid var(--rule); border-radius: 999px; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .chip.owed { border-color: var(--owed); color: var(--owed); font-weight: 600; }
  .chip.owe { border-color: var(--owe); color: var(--owe); font-weight: 600; }
  .actions { display: flex; justify-content: flex-end; margin-top: 0.5rem; }
  .actions form { margin: 0; }
  .actions button { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 1rem; background: var(--card); color: var(--ink); border: 1.5px solid var(--rule); font-size: 0.875rem; font-weight: 650; }
  .actions button:hover { border-color: var(--muted); }
  .actions svg { width: 1rem; height: 1rem; }
  p#history { color: var(--muted); }

  form { margin: 0.5rem 0; }
  form.card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--rule); border-radius: 16px; padding: 1rem; }
  label { display: block; margin: 0.25rem 0; }
  input, select, button { font: inherit; min-height: 2.75rem; border-radius: 12px; }
  input, select { width: 100%; padding: 0 0.75rem; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  input[type="checkbox"] { width: 1.25rem; min-height: 1.25rem; margin: 0; accent-color: var(--accent); }
  button { border: 0; padding: 0 1.25rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; cursor: pointer; }
  button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }

  /* The two things people come to do, as buttons that open their own page. */
  .do { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.5rem; margin-top: 0.75rem; }
  a.button { display: flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: 0 1rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; text-decoration: none; text-align: center; }
  a.button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }
  .back { margin: 0 0 0.5rem; }
  h2.page { font-size: 1.25rem; margin: 0.75rem 0 0.5rem; }
  .back a, .more a { font-weight: 650; text-decoration: none; }
  .more { margin: 0.6rem 0 0; text-align: center; }
  /* "Add bill" comes first in the page so Enter adds the bill, but it shows
     last, after "Split equally", in the order people use them. */
  form.card > button { order: 1; width: 100%; margin-top: 0.75rem; }

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

function postForm(action: string, fields: Record<string, string>, label: string, cls = "", icon = ""): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`)
    .join("");
  const klass = cls === "" ? "" : ` class="${esc(cls)}"`;
  return `<form method="post" action="${esc(action)}">${hidden}<button type="submit"${klass}>${icon}${esc(label)}</button></form>`;
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
// the page fetches itself again (the house page or the full history) and swaps
// in the new #live section. The forms have pages of their own, so nothing typed
// is ever wiped. The page also re-fetches whenever the stream (re)opens, so
// someone coming back, or whose connection dropped, sees the current state.
// Without script, everything still works; only the live updates are lost.
const LIVE_SCRIPT = `
  let live = document.getElementById("live");
  const base = live.dataset.base;
  const page = live.dataset.page;
  async function refresh() {
    const res = await fetch(page, { cache: "no-store" });
    if (!res.ok) return;
    const next = new DOMParser().parseFromString(await res.text(), "text/html").getElementById("live");
    if (!next) return;
    live.replaceWith(next);
    live = next;
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
function avatar(person: Person, size = ""): string {
  const initial = [...person.name][0] ?? "";
  const cls = size === "" ? "avatar" : `avatar ${size}`;
  return `<span class="${cls}" data-initial="${esc(initial)}" style="--av: ${AVATARS[person.id % AVATARS.length]}"></span>`;
}

// The card's title already says which way the money goes, so the words that
// repeat it are kept for screen readers (and the row's text) but not shown.
function balanceLine(b: { person: Person; cents: number }): string {
  const name = `<span class="name">${esc(b.person.name)}</span>`;
  const who = b.cents > 0 ? `${name}<span class="sr"> owes you</span>` : `<span class="sr">You owe </span>${name}`;
  return `<li>${avatar(b.person)}<span class="who">${who}</span> <span class="amount">${formatCents(Math.abs(b.cents))}</span></li>`;
}

// Icons drawn as lines, in the button's own colour; they carry no text.
const ICON_DELETE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/></svg>`;
const ICON_NOT_ARRIVED = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>`;

// One history row. The viewer is "you", so a row reads from their side, and a
// share chip is coloured by which way that money goes for them.
function entryLine(entry: Entry, base: string, me: Person): string {
  const name = (p: Person): string => (p.id === me.id ? "You" : esc(p.name));
  if (entry.kind === "payment") {
    const what = `${name(entry.from)} paid ${entry.to.id === me.id ? "you" : esc(entry.to.name)}`;
    // Only the receiver can see whether the money arrived, so only they can say it didn't.
    const dispute = entry.toMe
      ? `<div class="actions">${postForm(`${base}/dispute`, { payment: String(entry.id) }, "Didn't get it", "", ICON_NOT_ARRIVED)}</div>`
      : "";
    return `<li class="payment"><div class="line"><span class="pill paid">Paid</span><span class="what">${what}</span><span class="total">${formatCents(entry.cents)}</span></div>${dispute}</li>`;
  }
  const total = entry.shares.reduce((sum, s) => sum + s.cents, 0);
  const iPaid = entry.paidBy.id === me.id;
  const chips = entry.shares
    .map((s) => {
      const side = iPaid && s.person.id !== me.id ? " owed" : !iPaid && s.person.id === me.id ? " owe" : "";
      return `<li class="chip${side}">${avatar(s.person, "small")}${name(s.person)} ${formatCents(s.cents)}</li>`;
    })
    .join("");
  const remove = entry.mine
    ? `<div class="actions">${postForm(`${base}/delete`, { bill: String(entry.id) }, "Delete", "", ICON_DELETE)}</div>`
    : "";
  return `<li class="bill"><div class="line"><span class="pill bill">Bill</span><span class="what">${entry.note === "" ? "Bill" : esc(entry.note)}</span><span class="total">${formatCents(total)}</span></div><div class="by">${avatar(entry.paidBy, "small")}${name(entry.paidBy)} paid</div><ul class="chips">${chips}</ul>${remove}</li>`;
}

// The same top on every house page: which house, who you are, and a way out
// if that isn't you.
function houseTop(view: HouseView, title = "Serumah"): string {
  return `      <header class="top">
        <h1>${esc(title)}</h1>
        <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong> · <a href="/h/${esc(view.code)}/join">Not you?</a></p>
      </header>`;
}

const backLink = (code: string): string => `<p class="back"><a href="/h/${esc(code)}">← Back</a></p>`;

const historyBox = (view: HouseView, entries: Entry[]): string =>
  `<section class="box"><h2>History</h2><ul id="history">${entries.map((e) => entryLine(e, `/h/${view.code}`, view.me)).join("")}</ul></section>`;

// How many history entries the house page shows before "See all history".
export const RECENT = 5;

export function housePage(view: HouseView): string {
  const base = `/h/${view.code}`;
  const owed = view.balances.filter((b) => b.cents > 0);
  const owing = view.balances.filter((b) => b.cents < 0);
  const sum = (list: { cents: number }[]): number => list.reduce((total, b) => total + Math.abs(b.cents), 0);
  const list = (id: string, items: string[], empty: string): string =>
    items.length === 0 ? `<p class="quiet">${empty}</p>` : `<ul id="${id}">${items.join("")}</ul>`;
  const summary =
    view.balances.length === 0
      ? `<p id="balances">Nobody owes anybody.</p>`
      : `<div id="totals"><div class="owed"><span class="label">Owed to you</span> <span class="total">${formatCents(sum(owed))}</span></div><div class="owe"><span class="label">You owe</span> <span class="total">${formatCents(sum(owing))}</span></div></div>`;
  const cards =
    view.balances.length === 0
      ? ""
      : `<div id="balances" class="pair">
          <section class="box"><h2>Owed to you</h2>${list("owed", owed.map(balanceLine), "Nobody owes you.")}</section>
          <section class="box"><h2>You owe</h2>${list("owing", owing.map(balanceLine), "You don't owe anybody.")}</section>
        </div>`;
  const more =
    view.history.length > RECENT ? `<p class="more"><a href="${esc(base)}/history">See all history (${view.history.length})</a></p>` : "";
  const history = view.history.length === 0 ? `<p id="history">No bills yet.</p>` : historyBox(view, view.history.slice(0, RECENT)) + more;

  return layout(
    "Serumah",
    `${houseTop(view)}
      ${view.notice ? `<p role="status">${esc(view.notice)}</p>` : ""}
      <section id="live" data-base="${esc(base)}" data-page="${esc(base)}">
        ${summary}
        <nav class="do"><a class="button" href="${esc(base)}/bill">+ Add a bill</a><a class="button secondary" href="${esc(base)}/pay">Record a payment</a></nav>
        ${cards}
        ${history}
      </section>`,
    LIVE_SCRIPT,
  );
}

export function historyPage(view: HouseView): string {
  const base = `/h/${view.code}`;
  return layout(
    "History",
    `${houseTop(view)}
      ${backLink(view.code)}
      <section id="live" data-base="${esc(base)}" data-page="${esc(base)}/history">
        ${view.history.length === 0 ? `<p id="history">No bills yet.</p>` : historyBox(view, view.history)}
      </section>`,
    LIVE_SCRIPT,
  );
}

export function billPage(view: HouseView, draft?: Draft): string {
  const base = `/h/${view.code}`;
  const d = draft ?? { note: "", total: "", amounts: {}, ticked: view.people.map((p) => p.id) };
  const rows = view.people
    .map(
      (p) =>
        `<p class="row"><label><input type="checkbox" name="with_${p.id}"${d.ticked.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label> <input name="amount_${p.id}" inputmode="decimal" size="8" autocomplete="off" value="${esc(d.amounts[p.id] ?? "")}" aria-label="${esc(p.name)}'s amount" /></p>`,
    )
    .join("\n          ");
  // "Add bill" comes first so pressing Enter in a box adds the bill rather
  // than refilling the form.
  return layout(
    "Add a bill",
    `${houseTop(view)}
      ${backLink(view.code)}
      <h2 class="page">Add a bill you paid</h2>
      <form class="card" method="post" action="${esc(base)}/bill">
        ${alertLine(d.message)}
        <label>What for <input name="note" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(d.note)}" /></label>
        <fieldset>
          <legend>Who owes what (in dollars)</legend>
          ${rows}
        </fieldset>
        <button type="submit" name="intent" value="add">Add bill</button>
        <p class="split"><label>Or split a total equally between the ticked people <input name="total" inputmode="decimal" size="8" autocomplete="off" value="${esc(d.total)}" /></label>
        <button type="submit" name="intent" value="fill" class="secondary">Split equally</button></p>
      </form>`,
  );
}

export type PayDraft = { to: string; amount: string; message?: string };

export function payPage(view: HouseView, draft?: PayDraft): string {
  const base = `/h/${view.code}`;
  const others = view.people.filter((p) => p.id !== view.me.id);
  const form =
    others.length === 0
      ? `<p class="quiet">Nobody else is in the house yet. Share the code <strong>${esc(view.code)}</strong>.</p>`
      : `<form class="card" method="post" action="${esc(base)}/pay">
        ${alertLine(draft?.message)}
        <label>To <select name="to">${others.map((p) => `<option value="${p.id}"${draft?.to === String(p.id) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
        <label>Amount <input name="amount" inputmode="decimal" size="8" required autocomplete="off" value="${esc(draft?.amount ?? "")}" /></label>
        <button type="submit">I paid this</button>
      </form>`;
  return layout(
    "Record a payment",
    `${houseTop(view)}
      ${backLink(view.code)}
      <h2 class="page">Record a payment you made</h2>
      ${form}`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `      <h1>${esc(title)}</h1>\n      <p>${esc(message)}</p>\n      <p><a href="/">Home</a></p>`);
}
