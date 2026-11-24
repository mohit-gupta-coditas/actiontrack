export interface Attendee {
  name: string;
  first: string;
  email: string | null;
}

export type OwnerStatus = 'resolved' | 'ambiguous' | 'unknown' | 'unassigned';

export interface OwnerResult {
  status: OwnerStatus;
  /** Name as written in the note, e.g. "Priya". */
  raw: string | null;
  attendee: Attendee | null;
  candidates: Attendee[];
  /** Item text with the owner prefix removed. */
  rest: string;
}

/** "Priya Sharma <priya@x.com>", "priya@x.com" or "Priya Sharma". */
export function parseAttendee(input: string): Attendee | null {
  const s = input.trim();
  if (!s) return null;
  const angled = s.match(/^(.*?)\s*<([^>\s]+@[^>\s]+)>$/);
  if (angled) {
    const name = angled[1].trim() || localPart(angled[2]);
    return { name, first: firstWord(name), email: angled[2].toLowerCase() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(s)) {
    return { name: localPart(s), first: firstWord(localPart(s)), email: s.toLowerCase() };
  }
  return { name: s, first: firstWord(s), email: null };
}

// One owner: "Priya", "Priya Sharma", "Priya N." or "@anita".
const NAME = String.raw`(?:@[\w.'-]+|[A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)`;
// "Priya to …", "Priya Sharma will …", "Rahul: …", "@anita: …", "Anita & Rahul to …", "Lena (with Priya) to …"
const OWNER_PREFIX = new RegExp(
  String.raw`^(${NAME}(?:\s*(?:,|&|\band\b)\s*${NAME})*)(?:\s*\([^)]*\))?\s*(?::\s*|\s+(?:to|will|should|must)\s+)`);
const NAME_SEPARATOR = /\s*(?:,|&|\band\b)\s*/;

// "Team to …", "TBD to …" name nobody in particular.
const PLACEHOLDERS = new Set(['team', 'tbd', 'tba', 'someone', 'somebody', 'anyone', 'everyone', 'all', 'nobody', 'owner']);

/**
 * Finds the owner(s) at the start of an action item. Always returns at least one result;
 * "Anita & Rahul to …" returns one result per person, all sharing the same `rest`.
 */
export function resolveOwners(text: string, attendees: Attendee[]): OwnerResult[] {
  const m = text.match(OWNER_PREFIX);
  if (!m) return [{ status: 'unassigned', raw: null, attendee: null, candidates: [], rest: text }];

  const rest = text.slice(m[0].length);
  const names = m[1].split(NAME_SEPARATOR).map(n => n.replace(/^@/, '').trim()).filter(Boolean);
  const results = names.map(name => resolveName(name, attendees, rest));

  const real = results.filter(r => r.status !== 'unassigned');
  if (real.length === 0) return [results[0]];
  // The same person named twice ("Priya N. and Priya Nair") is still one owner.
  const seen = new Set<string>();
  return real.filter(r => {
    const key = ownerKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Single-owner convenience: the first owner found. */
export function resolveOwner(text: string, attendees: Attendee[]): OwnerResult {
  return resolveOwners(text, attendees)[0];
}

function resolveName(raw: string, attendees: Attendee[], rest: string): OwnerResult {
  const wanted = raw.toLowerCase();
  if (PLACEHOLDERS.has(wanted)) return { status: 'unassigned', raw, attendee: null, candidates: [], rest };

  let matches = attendees.filter(a => a.name.toLowerCase() === wanted);
  if (matches.length === 0 && !wanted.includes(' ')) {
    matches = attendees.filter(a => a.first.toLowerCase() === wanted || (a.email && localPart(a.email) === wanted));
  }
  // "Priya N." -> first name plus the initial of a later name.
  const initial = wanted.match(/^(\S+)\s+(\p{L})\.?$/u);
  if (matches.length === 0 && initial) {
    matches = attendees.filter(a => {
      const [first, ...others] = a.name.toLowerCase().split(/\s+/);
      return first === initial[1] && others.some(o => o.startsWith(initial[2]));
    });
  }

  if (matches.length === 1) return { status: 'resolved', raw, attendee: matches[0], candidates: [], rest };
  if (matches.length > 1) return { status: 'ambiguous', raw, attendee: null, candidates: matches, rest };
  return { status: 'unknown', raw, attendee: null, candidates: [], rest };
}

/**
 * Stable identity for an owner, used for dedup and filtering.
 * Uses the attendee's full name, so "Priya Nair" and "Priya Shah" never collide and the same
 * person matches across notes that do and don't list emails. Emails are looked up separately.
 */
export function ownerKey(o: Pick<OwnerResult, 'status' | 'raw' | 'attendee'>): string {
  if (o.status === 'unassigned') return 'unassigned';
  if (o.attendee) return `name:${o.attendee.name.toLowerCase()}`;
  return `raw:${(o.raw ?? '').toLowerCase()}`;
}

function localPart(email: string): string {
  return email.split('@')[0].toLowerCase();
}

function firstWord(name: string): string {
  return name.split(/\s+/)[0];
}
