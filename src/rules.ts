// The kitchen's rules, as plain functions over the recorded history. No
// database and no web code, so every rule can be checked directly.

export type KitchenState = "clean" | "messy";

export type Session = {
  personId: number;
  startedAt: number;
  endedAt: number | null;
};

export type Mark = {
  state: KitchenState;
  markedBy: number;
  at: number;
};

function latest<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    if (best === undefined || key(item) > key(best)) best = item;
  }
  return best;
}

// When the current mess began: the first messy mark since the last clean one.
// A repeated messy mark does not restart it, so repeating "messy" can never
// move the blame. Null when the kitchen is clean.
function messySince(marks: Mark[]): number | null {
  let since: number | null = null;
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    if (m.state === "messy") since ??= m.at;
    else since = null;
  }
  return since;
}

// Everyone with an open session. Several people can cook at once.
export function cookingNow(sessions: Session[]): number[] {
  return sessions.filter((s) => s.endedAt === null).map((s) => s.personId);
}

// The latest mark wins; a new house has no marks and starts clean.
export function kitchenState(marks: Mark[]): KitchenState {
  return messySince(marks) === null ? "clean" : "messy";
}

// The person of the most recent session, shown as a plain fact.
export function lastCooked(sessions: Session[]): number | null {
  return latest(sessions, (s) => s.startedAt)?.personId ?? null;
}

// Only while the kitchen is messy: the person of the most recent session that
// started before the mess began. Someone who starts cooking in a kitchen that
// is already messy is not blamed for it.
export function responsible(sessions: Session[], marks: Mark[]): number | null {
  const since = messySince(marks);
  if (since === null) return null;
  const before = sessions.filter((s) => s.startedAt < since);
  return latest(before, (s) => s.startedAt)?.personId ?? null;
}
