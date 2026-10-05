export const NAME_MAX = 24;

// Bidirectional override and isolate controls can scramble the page around a name.
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/u;

// Names are shown to everyone in the house, so they are trimmed, collapsed to
// single spaces, composed to one Unicode form and length-limited. Null means
// the name cannot be used.
export function normaliseName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").normalize("NFC");
  if (name === "" || [...name].length > NAME_MAX) return null;
  if (/\p{Cc}/u.test(name) || BIDI_CONTROLS.test(name)) return null;
  // A name made only of invisible characters would show as blank.
  if (!/[\p{L}\p{N}\p{S}\p{P}]/u.test(name)) return null;
  return name;
}

// What makes two names "the same": case and invisible characters are ignored.
export function nameKey(name: string): string {
  return name.replace(/\p{Default_Ignorable_Code_Point}/gu, "").toLowerCase();
}
