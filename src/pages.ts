import { NAME_MAX } from "./names.ts";
import type { KitchenState } from "./rules.ts";
import type { Person } from "./store.ts";

export type KitchenView = {
  code: string;
  me: Person;
  cooking: Person[];
  state: KitchenState;
  responsible: Person | null;
  lastCooked: Person | null;
  iAmCooking: boolean;
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
`;

export function layout(title: string, body: string): string {
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
    "Kitchen",
    `      <h1>Kitchen</h1>
      <p>See who is cooking in your house, and whether the kitchen was left clean.</p>
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
      <p>You're already in this house as <strong>${esc(current.name)}</strong>. <a href="/h/${esc(code)}">Go to the kitchen</a></p>`;
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

export function kitchenPage(view: KitchenView): string {
  const base = `/h/${view.code}`;
  // Anyone can end someone else's session, so a forgotten "I'm done" never
  // leaves a housemate cooking overnight. Your own session ends with "I'm done".
  const endButton = (p: Person): string =>
    p.id === view.me.id ? "" : postForm(`${base}/cook`, { action: "end", person: String(p.id) }, `End ${p.name}'s session`);
  const cooking =
    view.cooking.length === 0
      ? "<p>Nobody right now.</p>"
      : `<ul>${view.cooking.map((p) => `<li><span class="name">${esc(p.name)}</span>${endButton(p)}</li>`).join("")}</ul>`;
  const left =
    view.state === "messy" && view.responsible !== null
      ? `<p>Left by <strong>${esc(view.responsible.name)}</strong>.</p>`
      : "";
  const last = view.lastCooked === null ? "" : `<p class="quiet">Last cooked: ${esc(view.lastCooked.name)}</p>`;
  const cookButton = view.iAmCooking
    ? postForm(`${base}/cook`, { action: "stop" }, "I'm done")
    : postForm(`${base}/cook`, { action: "start" }, "I'm cooking");
  const markButton =
    view.state === "messy"
      ? postForm(`${base}/mark`, { state: "clean" }, "Mark clean")
      : postForm(`${base}/mark`, { state: "messy" }, "Mark messy");
  return layout(
    "Kitchen",
    `      <h1>Kitchen</h1>
      <p class="quiet">House <strong>${esc(view.code)}</strong> · you are <strong>${esc(view.me.name)}</strong> · <a href="${esc(base)}/join">Not you?</a></p>
      <h2>Cooking now</h2>
      ${cooking}
      <h2>The kitchen is ${view.state}</h2>
      ${left}
      ${last}
      ${cookButton}
      ${markButton}`,
  );
}

export function handoffPage(code: string): string {
  const base = `/h/${code}`;
  return layout(
    "Leaving the kitchen",
    `      <h1>Left the kitchen clean or messy?</h1>
      ${postForm(`${base}/mark`, { state: "clean" }, "Left it clean")}
      ${postForm(`${base}/mark`, { state: "messy" }, "Left it messy")}
      <p><a href="${esc(base)}">Skip</a></p>`,
  );
}

export function messagePage(title: string, message: string): string {
  return layout(title, `      <h1>${esc(title)}</h1>\n      <p>${esc(message)}</p>\n      <p><a href="/">Home</a></p>`);
}
