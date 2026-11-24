import type { Db } from '../db.js';
import { renderFollowup, type EmailDraft } from '../email/template.js';
import { UserError } from '../errors.js';
import { resolveOwnerQuery } from '../owners.js';
import { emailFor, PEOPLE_FILE } from '../people.js';
import { list } from './list.js';

export interface FollowupResult {
  draft: EmailDraft | null;
  itemIds: number[];
}

/** Builds (never sends) a follow-up email covering an owner's open and overdue items. */
export function followup(db: Db, ownerQuery: string, today?: string): FollowupResult {
  const key = resolveOwnerQuery(db, ownerQuery);
  if (!key.startsWith('name:')) {
    throw new UserError(
      `"${ownerQuery}" is not a known attendee, so there is no email address to write to; ` +
      'fix the owner name in the note and re-ingest');
  }

  const items = list(db, { owner: key, status: 'open', today });
  if (items.length === 0) return { draft: null, itemIds: [] };

  const name = items[0].owner_name ?? key.slice('name:'.length);
  const to = items.find(i => i.owner_email)?.owner_email ?? emailFor(db, name);
  if (!to) {
    throw new UserError(
      `no email address for ${name}; add "${name}": "<email>" to ${PEOPLE_FILE} in your notes folder and re-run ingest`);
  }
  return { draft: renderFollowup(to, name, items), itemIds: items.map(i => i.id) };
}
