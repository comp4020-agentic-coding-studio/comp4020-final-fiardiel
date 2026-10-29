import { formatCents } from "./money.ts";
import { NAME_MAX, NOTE_MAX } from "./names.ts";
import type { Person } from "./store.ts";

// A receipt line on the bill form, as the payer left it: the price as typed, and who is ticked.
export type DraftItem = { name: string; price: string; people: number[] };
// With `items`, the bill is split by item (only after reading a receipt), and
// `shares` are each person's share worked out from them. Without, it is split by amount.
export type Draft = {
  note: string;
  total: string;
  amounts: Record<number, string>;
  ticked: number[];
  items?: DraftItem[];
  receiptTotal?: string;
  shares?: { person: Person; cents: number }[];
  message?: string;
};

export type Entry =
  | {
      kind: "bill";
      id: number;
      paidBy: Person;
      note: string;
      shares: { person: Person; cents: number }[];
      items?: { name: string; cents: number; people: Person[] }[];
      mine: boolean;
    }
  | { kind: "payment"; id: number; from: Person; to: Person; cents: number; toMe: boolean }
  | { kind: "pin"; person: Person };

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
// a bill, plum for a payment. Buttons stay neutral, except Delete, which is
// red because it removes something; red never marks money. Each housemate has a
// coloured initial so people are easy to tell apart at a glance.
const STYLE = `
  :root {
    color-scheme: light dark;
    --paper: #f8f6f2; --card: #ffffff; --ink: #1f2430; --muted: #6f7684;
    --rule: #e6e3dd; --accent: #2f4fa2; --on-accent: #ffffff; --pill: #eceae5;
    --owed: #2f4fa2; --owe: #b8643e; --strip-owed: #e6ebf7; --strip-owe: #f8e9e1;
    --bill-bg: #f5e9c4; --bill-ink: #74570d; --paid-bg: #ebdcf3; --paid-ink: #6b3d84;
    --danger: #b3261e; --on-danger: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #13161f; --card: #1d2230; --ink: #e8ebf5; --muted: #9aa2b5;
      --rule: #2c3346; --accent: #8aa6ff; --on-accent: #13161f; --pill: #2a3142;
      --owed: #8aa6ff; --owe: #ef9a70; --strip-owed: #1d2847; --strip-owe: #3a2620;
      --bill-bg: #3a3118; --bill-ink: #e6c766; --paid-bg: #33263e; --paid-ink: #d2abe8;
      --danger: #ff6b66; --on-danger: #13161f;
    }
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 32rem; margin: 0 auto; padding: 1.75rem 1.25rem 3rem; }
  h1 { font: 700 2rem/1.15 Georgia, "Times New Roman", serif; margin: 0 0 1rem; }
  h2 { font-size: 0.95rem; font-weight: 650; margin: 2rem 0 0.75rem; }
  a { color: var(--accent); }
  .quiet { color: var(--muted); font-size: 0.875rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: 0; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* Spacing keeps to three distances: about 8px between the parts of one
     thing, 12 to 16px between rows, and 24 to 32px between groups. */
  .top { margin-bottom: 1.5rem; }
  .top h1 { margin: 0 0 0.375rem; }
  .top p { margin: 0; line-height: 1.6; }

  #totals { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; margin: 0; }
  #totals > div { padding: 1rem 1.125rem; border-radius: 18px; }
  #totals .owed { background: var(--strip-owed); }
  #totals .owe { background: var(--strip-owe); text-align: right; }
  #totals .label { display: block; margin-bottom: 0.25rem; font-size: 0.8rem; color: var(--muted); }
  #totals .total { display: block; font-size: 1.75rem; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.2; }
  #totals .owed .total { color: var(--owed); }
  #totals .owe .total { color: var(--owe); }
  p#balances { margin: 0; padding: 1.25rem; background: var(--strip-owed); border-radius: 16px; font-size: 1.2rem; font-weight: 600; }

  .pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; margin-top: 2rem; }
  .box { background: var(--card); border: 1px solid var(--rule); border-radius: 18px; padding: 1.125rem 1.25rem 0.5rem; }
  .box h2 { margin: 0 0 0.5rem; }
  .box p.quiet { margin: 0.75rem 0 1rem; }
  #live > .box, #live > p#history { margin-top: 2rem; }
  .back + #live > :first-child { margin-top: 0; }

  #owed li, #owing li { display: flex; align-items: center; gap: 0.875rem; padding: 0.875rem 0; border-top: 1px solid var(--rule); }
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
  #history > li { padding: 1.125rem 0; border-top: 1px solid var(--rule); }
  .line { display: flex; align-items: baseline; gap: 0.625rem; line-height: 1.35; }
  .pill { flex: none; padding: 0.125rem 0.625rem; border-radius: 999px; background: var(--pill); color: var(--muted); font-size: 0.72rem; font-weight: 700; }
  .pill.bill { background: var(--bill-bg); color: var(--bill-ink); }
  .pill.paid { background: var(--paid-bg); color: var(--paid-ink); }
  .what { flex: 1; min-width: 0; font-size: 1.05rem; font-weight: 650; overflow-wrap: anywhere; }
  .line .total { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .by { display: flex; align-items: center; gap: 0.5rem; margin: 0.5rem 0 0.75rem; color: var(--muted); font-size: 0.85rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .chip { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.75rem 0.25rem 0.25rem; border: 1px solid var(--rule); border-radius: 999px; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .chip.owed { border-color: var(--owed); color: var(--owed); font-weight: 600; }
  .chip.owe { border-color: var(--owe); color: var(--owe); font-weight: 600; }
  .actions { display: flex; justify-content: flex-end; margin-top: 0.875rem; }
  .actions form { margin: 0; }
  .actions button { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 1rem; background: var(--card); color: var(--ink); border: 1.5px solid var(--rule); font-size: 0.875rem; font-weight: 650; }
  .actions button:hover { border-color: var(--muted); }
  .actions svg { width: 1rem; height: 1rem; }

  /* Delete is the one red thing on the page, and red means only that: this
     removes something. It asks first, in the row, before anything is sent. */
  .confirm { margin-top: 0.875rem; }
  .confirm summary { display: flex; align-items: center; gap: 0.4rem; width: max-content; min-height: 2.5rem; margin-left: auto; padding: 0 1rem; border: 1.5px solid var(--danger); border-radius: 999px; color: var(--danger); font-size: 0.875rem; font-weight: 650; cursor: pointer; list-style: none; }
  .confirm summary::-webkit-details-marker { display: none; }
  .confirm summary svg { width: 1rem; height: 1rem; }
  .confirm[open] summary { border-color: var(--rule); color: var(--ink); }
  .confirm[open] summary svg, .confirm .opened, .confirm[open] .closed { display: none; }
  .confirm[open] .opened { display: inline; }
  .ask { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; margin-top: 0.75rem; padding: 0.875rem 1rem; border: 1.5px solid var(--danger); border-radius: 14px; }
  .ask p { margin: 0; font-weight: 600; }
  .ask form { margin: 0; }
  button.danger { display: inline-flex; align-items: center; gap: 0.4rem; min-height: 2.5rem; padding: 0 1rem; background: var(--danger); color: var(--on-danger); font-size: 0.875rem; }
  button.danger svg { width: 1rem; height: 1rem; }
  p#history { color: var(--muted); }
  main > p.quiet:last-child { margin: 2.5rem 0 0; }

  form { margin: 0.75rem 0; }
  main > form { margin: 1.25rem 0; }
  label + button { margin-top: 0.75rem; }
  form.card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--rule); border-radius: 18px; padding: 1.25rem; gap: 1rem; }
  label { display: block; margin: 0; }
  label > input:not([type="checkbox"]), label > select { display: block; margin-top: 0.375rem; }
  input, select, button { font: inherit; min-height: 2.75rem; border-radius: 12px; }
  input, select { width: 100%; padding: 0 0.75rem; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); }
  input[type="checkbox"] { width: 1.25rem; min-height: 1.25rem; margin: 0; accent-color: var(--accent); }
  button { border: 0; padding: 0 1.25rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; cursor: pointer; }
  button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }

  /* The two things people come to do, as buttons that open their own page. */
  .do { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; margin-top: 1rem; }
  a.button { display: flex; align-items: center; justify-content: center; min-height: 2.75rem; padding: 0 1rem; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 700; text-decoration: none; text-align: center; }
  a.button.secondary { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); }
  .back { margin: 0 0 1rem; }
  h2.page { font-size: 1.25rem; margin: 0 0 1rem; }
  .back a, .more a { font-weight: 650; text-decoration: none; }
  .more { margin: 1rem 0 0; text-align: center; }
  /* "Add bill" comes first in the page so Enter adds the bill, but it shows
     last, after "Split equally", in the order people use them. */
  form.card > button { order: 1; width: 100%; margin-top: 0.5rem; }

  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  legend { padding: 0; font-size: 0.875rem; color: var(--muted); margin-bottom: 0.375rem; }
  .row { display: grid; grid-template-columns: 1fr 7rem; align-items: center; gap: 1rem; margin: 0; padding: 0.625rem 0; border-bottom: 1px solid var(--rule); }
  .row label { display: flex; align-items: center; gap: 0.75rem; margin: 0; }
  .row input:not([type="checkbox"]), .split input { text-align: right; }
  .split { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 0.75rem; margin: 0; }
  .split label { margin: 0; font-size: 0.875rem; line-height: 1.4; color: var(--muted); }
  /* A receipt line: its name and price box, then who shares it. */
  .item { display: grid; grid-template-columns: 1fr 6.5rem; align-items: center; gap: 0.375rem 0.75rem; padding: 0.625rem 0; border-bottom: 1px solid var(--rule); }
  .item-name { overflow-wrap: anywhere; }
  .item input:not([type="checkbox"]) { text-align: right; }
  .ticks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.375rem 1rem; margin: 0; font-size: 0.875rem; }
  .ticks label { display: inline-flex; align-items: center; gap: 0.375rem; }
  .shares { list-style: none; padding: 0; margin: 0; font-variant-numeric: tabular-nums; }
  .shares li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.375rem 0; border-bottom: 1px solid var(--rule); }
  .bought summary { margin-top: 0.75rem; color: var(--muted); font-size: 0.85rem; cursor: pointer; }
  .bought ul { list-style: none; padding: 0; margin: 0.375rem 0 0; font-size: 0.875rem; }
  .bought li { display: flex; flex-wrap: wrap; gap: 0 0.5rem; padding: 0.375rem 0; border-bottom: 1px solid var(--rule); }
  .bought .item-name { flex: 1; }
  .bought .price { font-variant-numeric: tabular-nums; }
  .bought .people { flex-basis: 100%; color: var(--muted); font-size: 0.8rem; }
  [role="alert"], [role="status"] { margin: 0 0 1rem; padding: 0.75rem 1rem; background: var(--card); border-left: 3px solid var(--accent); border-radius: 8px; }

  /* Sign-in screens: one job each, centred, like picking a profile. The
     coloured initials are the same ones people have on the house page. */
  .solo { min-height: 70vh; display: flex; flex-direction: column; }
  .solo .middle { flex: 1; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; width: 100%; max-width: 24rem; margin: 0 auto; }
  .solo .middle form { max-width: 20rem; }
  .solo .middle h1 { font-size: 1.75rem; margin: 0 0 1.5rem; }
  .solo .middle h1.brand { font-size: 2.75rem; margin: 0 0 0.25rem; }
  .solo .middle form { width: 100%; margin: 0; }
  .solo .middle button { width: 100%; margin-top: 1rem; }
  .solo .middle [role="alert"] { width: 100%; text-align: left; }
  .solo .foot { margin: 1.5rem 0 0; text-align: center; }
  .solo .foot a { font-weight: 650; text-decoration: none; }
  .solo input { text-align: center; font-size: 1.15rem; min-height: 3rem; background: var(--card); }
  input.code { font: 700 1.4rem ui-monospace, Menlo, monospace; letter-spacing: 0.2em; text-transform: uppercase; }
  input.pin { -webkit-text-security: disc; width: 11rem; margin: 0 auto; font: 700 1.75rem ui-monospace, Menlo, monospace; letter-spacing: 0.6em; text-indent: 0.6em; }
  .tiles { display: flex; flex-wrap: wrap; gap: 1.5rem; justify-content: center; }
  .tile { width: 6.5rem; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; color: var(--ink); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .face { width: 5.5rem; height: 5.5rem; border-radius: 24px; background: var(--av); display: flex; align-items: center; justify-content: center; }
  .face::before { content: attr(data-initial); color: #fff; font: 700 2.2rem/1 Georgia, serif; }
  .middle > .face { margin-bottom: 1rem; }
  .tile:hover .face, .tile:focus-visible .face { outline: 3px solid var(--accent); outline-offset: 3px; }
  .tile small { margin-top: -0.375rem; color: var(--muted); font-weight: 400; font-size: 0.75rem; }
  .tile.new .face { background: transparent; border: 2px dashed var(--muted); }
  .tile.new .face::before { color: var(--muted); font: 400 2.2rem/1 system-ui, sans-serif; }
  .houses { display: grid; gap: 0.75rem; width: 100%; margin: 1.25rem 0 0; }
  .house { display: flex; align-items: center; gap: 0.875rem; padding: 0.875rem 1rem; background: var(--card); border: 1px solid var(--rule); border-radius: 18px; color: var(--ink); text-align: left; text-decoration: none; }
  .house .face { width: 2.75rem; height: 2.75rem; border-radius: 14px; }
  .house .face::before { font-size: 1.25rem; }
  .house .code { display: block; font: 700 1rem ui-monospace, Menlo, monospace; letter-spacing: 0.08em; }
  .house small { color: var(--muted); }
  form.inline { display: inline; margin: 0; }
  button.link { min-height: 0; padding: 0; background: none; color: var(--accent); font-weight: 650; }
  #history > li.fact { color: var(--muted); font-size: 0.9rem; }

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

// A big coloured initial, the profile picture on the sign-in screens.
function face(person: Person): string {
  return `<span class="face" data-initial="${esc([...person.name][0] ?? "")}" style="--av: ${AVATARS[person.id % AVATARS.length]}"></span>`;
}

// Every sign-in screen: one job in the middle, a way back on top, and at most
// one small link at the foot.
function solo(title: string, middle: string, back?: { href: string; label: string }, foot = ""): string {
  const top = back === undefined ? "" : `<p class="back"><a href="${esc(back.href)}">‹ ${esc(back.label)}</a></p>`;
  return layout(
    title,
    `      <div class="solo">${top}
        <div class="middle">
${middle}
        </div>${foot === "" ? "" : `
        <div class="foot">${foot}</div>`}
      </div>`,
  );
}

// Not a password field: a browser would save one person's PIN and offer it on
// another person's page, the very accident PINs are for. The digits are hidden
// with the text-security mask instead.
const PIN_INPUT = (label: string): string =>
  `<input class="pin" name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" minlength="4" required autocomplete="one-time-code" autofocus aria-label="${esc(label)}" />`;

const CODE_INPUT = `<input class="code" name="code" required maxlength="12" autocomplete="off" autocapitalize="characters" placeholder="House code" aria-label="House code" autofocus />`;

// Home asks for one thing, the code; a device that knows you shows its houses
// instead. Starting a house is the small thing at the foot.
export function homePage(message?: string, mine: { code: string; name: string }[] = []): string {
  const middle =
    mine.length === 0
      ? `          <form method="get" action="/join">${CODE_INPUT}<button type="submit">Go</button></form>`
      : `          <h2 class="sr">Your houses</h2>
          <div class="houses">${mine.map((h) => `<a class="house" href="/h/${esc(h.code)}">${face({ id: 0, name: h.name })}<span><span class="code">${esc(h.code)}</span><small>as ${esc(h.name)}</small></span></a>`).join("")}</div>
          <form method="get" action="/join" style="margin-top:1.25rem">${CODE_INPUT}<button type="submit" class="secondary">Go</button></form>`;
  return solo(
    "Serumah",
    `          <h1 class="brand">Serumah</h1>
          <p class="quiet">Your house's bills, split. Based on Serumah, the Telegram bot by <a href="https://github.com/davinpwk">davinpwk</a>.</p>
          ${alertLine(message)}
${middle}`,
    undefined,
    `<form class="inline" method="post" action="/houses"><button type="submit" class="link">Start a new house</button></form>`,
  );
}

// "Who's using Serumah?": only the faces. This device's own name goes straight
// to the house; anyone else's asks for their PIN.
export function joinPage(code: string, people: Person[], current: Person | null = null): string {
  const tile = (p: Person): string =>
    current !== null && p.id === current.id
      ? `<a class="tile" href="/h/${esc(code)}">${face(p)}<span class="name">${esc(p.name)}</span><small>this device</small></a>`
      : `<a class="tile" href="/h/${esc(code)}/as/${p.id}">${face(p)}<span class="name">${esc(p.name)}</span></a>`;
  return solo(
    "Who's using Serumah?",
    `          <h1>Who's using Serumah?</h1>
          <div class="tiles">${people.map(tile).join("")}<a class="tile new" href="/h/${esc(code)}/new"><span class="face" data-initial="+"></span>New</a></div>`,
    { href: "/", label: "Home" },
    `<span class="quiet">House <strong>${esc(code)}</strong>. Share this code with your housemates.</span>`,
  );
}

export function newNamePage(code: string, message?: string, name = ""): string {
  return solo(
    "Your name",
    `          <h1>What's your name?</h1>
          ${alertLine(message)}
          <form method="post" action="/h/${esc(code)}/new"><input name="name" value="${esc(name)}" required maxlength="${NAME_MAX}" autocomplete="off" autofocus aria-label="Your name" /><button type="submit">Next</button></form>`,
    { href: `/h/${code}/join`, label: "Back" },
  );
}

export function newPinPage(code: string, name: string, message?: string): string {
  return solo(
    "Choose a PIN",
    `          ${face({ id: 0, name })}
          <h1>Choose a PIN, ${esc(name)}</h1>
          ${alertLine(message)}
          <form method="post" action="/h/${esc(code)}/join"><input type="hidden" name="name" value="${esc(name)}" />${PIN_INPUT("4-digit PIN")}<button type="submit">Join</button></form>`,
    { href: `/h/${code}/new`, label: "Back" },
    `<span class="quiet">You'll need it to open your name on another device.</span>`,
  );
}

export function pinPage(code: string, person: Person, message?: string): string {
  return solo(
    `${person.name}'s PIN`,
    `          ${face(person)}
          <h1>${esc(person.name)}'s PIN</h1>
          ${alertLine(message)}
          <form method="post" action="/h/${esc(code)}/as/${person.id}">${PIN_INPUT(`${person.name}'s PIN`)}<button type="submit">Open</button></form>`,
    { href: `/h/${code}/join`, label: `Not ${person.name}` },
    `<a href="/h/${esc(code)}/reset/${person.id}">Forgot my PIN</a>`,
  );
}

export function resetCodePage(code: string, person: Person, message?: string): string {
  return solo(
    "Forgot my PIN",
    `          ${face(person)}
          <h1>Type your house's code</h1>
          ${alertLine(message)}
          <form method="post" action="/h/${esc(code)}/reset/${person.id}">${CODE_INPUT}<button type="submit">Next</button></form>`,
    { href: `/h/${code}/as/${person.id}`, label: "Back" },
    `<span class="quiet">This shows the reset is on purpose.</span>`,
  );
}

// The code typed on the step before rides along, so the server checks it again.
export function resetPinPage(code: string, person: Person, typedCode: string, message?: string): string {
  return solo(
    "Choose a new PIN",
    `          ${face(person)}
          <h1>Choose a new PIN, ${esc(person.name)}</h1>
          ${alertLine(message)}
          <form method="post" action="/h/${esc(code)}/reset/${person.id}"><input type="hidden" name="code" value="${esc(typedCode)}" />${PIN_INPUT("New 4-digit PIN")}<button type="submit">Save PIN</button></form>`,
    { href: `/h/${code}/reset/${person.id}`, label: "Back" },
    `<span class="quiet">Your other devices will ask for it next time.</span>`,
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
    // A delete question someone has open stays open through the update.
    for (const open of live.querySelectorAll("details.confirm[open]")) {
      next.querySelector('details.confirm[data-bill="' + open.dataset.bill + '"]')?.setAttribute("open", "");
    }
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
  // A plain fact for the whole house, with no pill or colour.
  if (entry.kind === "pin") return `<li class="fact">${esc(entry.person.name)}'s PIN was changed</li>`;
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
  // Deleting asks first, without needing script: "Delete" opens the question
  // (and becomes "Cancel"), and only "Yes, delete" sends the form.
  const remove = entry.mine
    ? `<details class="confirm" data-bill="${entry.id}"><summary>${ICON_DELETE}<span class="closed">Delete</span><span class="opened">Cancel</span></summary><div class="ask"><p>Delete this bill for everyone?</p>${postForm(`${base}/delete`, { bill: String(entry.id) }, "Yes, delete", "danger", ICON_DELETE)}</div></details>`
    : "";
  // A bill split by item shows what was in it, so a share comes with its reason.
  const bought =
    entry.items === undefined || entry.items.length === 0
      ? ""
      : `<details class="bought"><summary>What was bought</summary><ul>${entry.items
          .map(
            (i) =>
              `<li><span class="item-name">${esc(i.name)}</span><span class="price">${formatCents(i.cents)}</span><span class="people">${i.people.map(name).join(", ")}</span></li>`,
          )
          .join("")}</ul></details>`;
  return `<li class="bill"><div class="line"><span class="pill bill">Bill</span><span class="what">${entry.note === "" ? "Bill" : esc(entry.note)}</span><span class="total">${formatCents(total)}</span></div><div class="by">${avatar(entry.paidBy, "small")}${name(entry.paidBy)} paid</div><ul class="chips">${chips}</ul>${bought}${remove}</li>`;
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

// `scan` is whether this house may read receipts; other houses never see the upload.
export function billPage(view: HouseView, draft?: Draft, scan = false): string {
  const base = `/h/${view.code}`;
  const d = draft ?? { note: "", total: "", amounts: {}, ticked: view.people.map((p) => p.id) };
  const rows = view.people
    .map(
      (p) =>
        `<p class="row"><label><input type="checkbox" name="with_${p.id}"${d.ticked.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label> <input name="amount_${p.id}" inputmode="decimal" size="8" autocomplete="off" value="${esc(d.amounts[p.id] ?? "")}" aria-label="${esc(p.name)}'s amount" /></p>`,
    )
    .join("\n          ");
  const receipt = scan
    ? `<form class="card" method="post" action="${esc(base)}/receipt" enctype="multipart/form-data">
        <label>Photo of the receipt <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif" required /></label>
        <button type="submit" class="secondary">Read receipt</button>
      </form>`
    : "";
  const byItem = d.items !== undefined && d.items.length > 0;
  // Read off a receipt: one row per line, with a price box and who shares it.
  const itemRows = (d.items ?? [])
    .map(
      (item, i) =>
        `<div class="item" role="group" aria-labelledby="item-${i}"><span class="item-name" id="item-${i}">${esc(item.name)}</span><input type="hidden" name="item_name_${i}" value="${esc(item.name)}" /><input name="item_price_${i}" inputmode="decimal" autocomplete="off" value="${esc(item.price)}" aria-label="Price of ${esc(item.name)}" /><p class="ticks">${view.people
          .map(
            (p) =>
              `<label><input type="checkbox" name="item_${i}_with_${p.id}"${item.people.includes(p.id) ? " checked" : ""} /> ${esc(p.name)}</label>`,
          )
          .join("")}</p></div>`,
    )
    .join("\n          ");
  const split = byItem
    ? `<fieldset>
          <legend>What was bought, and who shares each thing</legend>
          <p class="quiet">Read from the receipt. Fix any price that's wrong, and untick anyone who didn't have it. Untick everyone to leave a line out.</p>
          ${itemRows}
        </fieldset>
        <fieldset>
          <legend>Each person's share</legend>
          <ul class="shares">${(d.shares ?? []).map((s) => `<li><span>${esc(s.person.name)}</span> <span>${formatCents(s.cents)}</span></li>`).join("")}</ul>
        </fieldset>
        <input type="hidden" name="receipt_total" value="${esc(d.receiptTotal ?? "")}" />
        <button type="submit" name="intent" value="add">Add bill</button>
        <p class="split"><span class="quiet">Changed a price or a tick?</span>
        <button type="submit" name="intent" value="items" class="secondary">Work out shares</button></p>
        <p class="quiet"><a href="${esc(base)}/bill">Type the bill in instead</a></p>`
    : `<fieldset>
          <legend>Who owes what (in dollars)</legend>
          ${rows}
        </fieldset>
        <button type="submit" name="intent" value="add">Add bill</button>
        <p class="split"><label>Or split a total equally between the ticked people <input name="total" inputmode="decimal" size="8" autocomplete="off" value="${esc(d.total)}" /></label>
        <button type="submit" name="intent" value="fill" class="secondary">Split equally</button></p>`;
  // "Add bill" comes first so pressing Enter in a box adds the bill rather
  // than refilling the form.
  return layout(
    "Add a bill",
    `${houseTop(view)}
      ${backLink(view.code)}
      <h2 class="page">Add a bill you paid</h2>
      ${receipt}
      <form class="card" method="post" action="${esc(base)}/bill">
        ${alertLine(d.message)}
        <label>What for <input name="note" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(d.note)}" /></label>
        ${split}
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
