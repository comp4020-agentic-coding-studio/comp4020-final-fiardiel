export const NAME_MAX = 24;

// Names are shown to everyone in the house, so they are trimmed, collapsed to
// single spaces and length-limited. Null means the name cannot be used.
export function normaliseName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "" || [...name].length > NAME_MAX) return null;
  if (/\p{Cc}/u.test(name)) return null;
  return name;
}
