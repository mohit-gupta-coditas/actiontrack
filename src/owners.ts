import type { Db } from './db.js';

export class UserError extends Error {}

interface OwnerRow {
  owner_key: string;
  owner_name: string | null;
  owner_raw: string | null;
  owner_status: string;
  owner_candidates: string | null;
}

/**
 * Turns what the user typed for --owner / followup into stored owner keys.
 * Accepts an email, a full name, a unique first name, "unassigned", or a raw key from `list --json`.
 * A first name shared by several owners is an error that lists them.
 */
export function resolveOwnerQuery(db: Db, query: string): string {
  const q = query.trim().toLowerCase();
  if (q === 'unassigned') return 'unassigned';
  if (q.includes('@') || q.startsWith('name:') || q.startsWith('raw:')) return q;

  const rows = db.prepare(
    'SELECT DISTINCT owner_key, owner_name, owner_raw, owner_status, owner_candidates FROM items',
  ).all() as unknown as OwnerRow[];

  let matches = rows.filter(r => r.owner_name?.toLowerCase() === q);
  if (matches.length === 0) {
    matches = rows.filter(r =>
      r.owner_name?.split(/\s+/)[0].toLowerCase() === q || (r.owner_status !== 'resolved' && r.owner_raw?.toLowerCase() === q));
  }
  const byKey = new Map(matches.map(r => [r.owner_key, r]));

  if (byKey.size === 1) return [...byKey.keys()][0];
  if (byKey.size === 0) throw new UserError(`no owner matches "${query}"`);
  const options = [...byKey.values()].map(describeOwner).map(s => `  - ${s}`).join('\n');
  throw new UserError(`"${query}" matches more than one owner; use one of these instead:\n${options}`);
}

function describeOwner(r: OwnerRow): string {
  if (r.owner_status === 'ambiguous') {
    const who = r.owner_candidates ? (JSON.parse(r.owner_candidates) as string[]).join(', ') : '';
    return `${r.owner_key}  ("${r.owner_raw}" in notes, could be: ${who})`;
  }
  if (r.owner_status === 'unknown') return `${r.owner_key}  ("${r.owner_raw}", not in attendees)`;
  return `${r.owner_key}  (${r.owner_name})`;
}

export function ownerLabel(r: Pick<OwnerRow, 'owner_status' | 'owner_name' | 'owner_raw'>): string {
  switch (r.owner_status) {
    case 'resolved': return r.owner_name ?? '';
    case 'ambiguous': return `${r.owner_raw} (ambiguous)`;
    case 'unknown': return `${r.owner_raw} (not in attendees)`;
    default: return '(unassigned)';
  }
}
