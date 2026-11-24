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

// "Priya to …", "Priya Sharma will …", "Rahul: …"
const OWNER_PREFIX = /^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*)?)\s*(?::\s*|\s+(?:to|will|should|must)\s+)/;

export function resolveOwner(text: string, attendees: Attendee[]): OwnerResult {
  const m = text.match(OWNER_PREFIX);
  if (!m) return { status: 'unassigned', raw: null, attendee: null, candidates: [], rest: text };

  const raw = m[1];
  const rest = text.slice(m[0].length);
  const wanted = raw.toLowerCase();

  let matches = attendees.filter(a => a.name.toLowerCase() === wanted);
  if (matches.length === 0 && !wanted.includes(' ')) {
    matches = attendees.filter(a => a.first.toLowerCase() === wanted || (a.email && localPart(a.email) === wanted));
  }

  if (matches.length === 1) return { status: 'resolved', raw, attendee: matches[0], candidates: [], rest };
  if (matches.length > 1) return { status: 'ambiguous', raw, attendee: null, candidates: matches, rest };
  return { status: 'unknown', raw, attendee: null, candidates: [], rest };
}

/**
 * Stable identity for an owner, used for dedup and filtering.
 * Prefers email so two people with the same first name never collide.
 */
export function ownerKey(o: Pick<OwnerResult, 'status' | 'raw' | 'attendee'>): string {
  if (o.status === 'unassigned') return 'unassigned';
  if (o.attendee?.email) return o.attendee.email;
  if (o.attendee) return `name:${o.attendee.name.toLowerCase()}`;
  return `raw:${(o.raw ?? '').toLowerCase()}`;
}

function localPart(email: string): string {
  return email.split('@')[0].toLowerCase();
}

function firstWord(name: string): string {
  return name.split(/\s+/)[0];
}
