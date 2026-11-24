import type { Db } from '../db.js';
import { renderFollowup, type EmailDraft } from '../email/template.js';
import { UserError } from '../errors.js';
import { resolveOwnerQuery } from '../owners.js';
import { list } from './list.js';

export interface FollowupResult {
  draft: EmailDraft | null;
  itemIds: number[];
}

/** Builds (never sends) a follow-up email covering an owner's open and overdue items. */
export function followup(db: Db, ownerQuery: string, today?: string): FollowupResult {
  const key = resolveOwnerQuery(db, ownerQuery);
  if (!key.includes('@')) {
    throw new UserError(`"${ownerQuery}" has no email address; fix the owner in the note's attendees and re-ingest`);
  }

  const items = list(db, { owner: key, status: 'open', today });
  if (items.length === 0) return { draft: null, itemIds: [] };
  return { draft: renderFollowup(key, items[0].owner_name, items), itemIds: items.map(i => i.id) };
}
