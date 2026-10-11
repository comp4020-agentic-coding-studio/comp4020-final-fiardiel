import { formatCents } from "./money.ts";
import { NAME_MAX, NOTE_MAX } from "./names.ts";
import type { Person } from "./store.ts";

export type Draft = { note: string; total: string; amounts: Record<number, string>; ticked: number[]; message?: string };

export type Entry =
  | { kind: "bill"; id: number; paidBy: Person; note: string; shares: { person: Person; cents: number }[]; mine: boolean }
  | { kind: "payment"; from: Person; to: Person; cents: number; pending: boolean };

export type HouseView = {
  code: string;
  me: Person;
  people: Person[];
  // Non-zero only, in name order. Positive: they owe me. Negative: I owe them.
  balances: { person: Person; cents: number }[];
  toAnswer: { id: number; from: Person; cents: number }[];
  waiting: { to: Person; cents: number }[];
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

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; font: 1rem/1.5 system-ui, sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1rem; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.15rem; }
  form { margin: 0.5rem 0; }
  button, input { font: inherit; min-height: 2.75rem; }
  button { padding: 0 1rem; }
  input { padding: 0 0.5rem; }
  .quiet { opacity: 0.7; }
  li form { display: inline; margin: 0 0 0 0.5rem; }
  fieldset { border: 0; padding: 0; margin: 0.5rem 0; }
  fieldset p { margin: 0.25rem 0; }
  #live li { margin: 0.25rem 0; }
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

function postForm(action: string, fields: Record<string, string>, label: string): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`)
    .join("");
  return `<form method="post" action="${esc(action)}">${hidden}<button type="submit">${esc(label)}</button></form>`;
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
      ${people.map((p) => postForm(`/h/${code}/claim`, { person: String(p.id) }, p.name)).join("\n      ")}`;
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
  return b.cents > 0
    ? `<li>${name} owes you ${formatCents(b.cents)}</li>`
    : `<li>You owe ${name} ${formatCents(-b.cents)}</li>`;
}

function entryLine(entry: Entry, base: string): string {
  if (entry.kind === "payment") {
    const waiting = entry.pending ? ` <span class="quiet">(waiting for ${esc(entry.to.name)})</span>` : "";
    return `<li>${esc(entry.from.name)} paid ${esc(entry.to.name)} ${formatCents(entry.cents)}${waiting}</li>`;
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
  const toAnswer =
    view.toAnswer.length === 0
      ? ""
      : `
        <h2>Did you get these?</h2>
        <ul>${view.toAnswer
          .map(
            (p) =>
              `<li>${esc(p.from.name)} says they paid you ${formatCents(p.cents)} ${postForm(`${base}/answer`, { payment: String(p.id), answer: "received" }, "Got it")}${postForm(`${base}/answer`, { payment: String(p.id), answer: "rejected" }, "Didn't get it")}</li>`,
          )
          .join("")}</ul>`;
  const waiting =
    view.waiting.length === 0
      ? ""
      : `
        <h2>Waiting for them to confirm</h2>
        <ul>${view.waiting.map((p) => `<li>You paid ${esc(p.to.name)} ${formatCents(p.cents)}</li>`).join("")}</ul>`;
  const history =
    view.history.length === 0
      ? `<p id="history">No bills yet.</p>`
      : `<ul id="history">${view.history.map((e) => entryLine(e, base)).join("")}</ul>`;

  const rows = view.people
    .map(
      (p) =>
        `<p><label><input type="checkbox" name="with_${p.id}"${draft.ticked.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label> <input name="amount_${p.id}" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.amounts[p.id] ?? "")}" aria-label="${esc(p.name)}'s amount" /></p>`,
    )
    .join("\n          ");
  const others = view.people.filter((p) => p.id !== view.me.id);
  const payForm =
    others.length === 0
      ? `<p class="quiet">Nobody else is in the house yet. Share the code <strong>${esc(view.code)}</strong>.</p>`
      : `<form method="post" action="${esc(base)}/pay">
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
        ${balances}${toAnswer}${waiting}
        <h2>History</h2>
        ${history}
      </section>
      <section id="forms">
      <p id="stale" role="status" hidden>Someone new joined the house. Once you've sent this, reload to include them.</p>
      <h2>Add a bill you paid</h2>
      <form method="post" action="${esc(base)}/bill">
        ${alertLine(draft.message)}
        <label>What for <input name="note" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(draft.note)}" /></label>
        <fieldset>
          <legend>Who owes what (in dollars)</legend>
          ${rows}
        </fieldset>
        <button type="submit" name="intent" value="add">Add bill</button>
        <p><label>Or split a total equally between the ticked people <input name="total" inputmode="decimal" size="8" autocomplete="off" value="${esc(draft.total)}" /></label>
        <button type="submit" name="intent" value="fill">Split equally</button></p>
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
