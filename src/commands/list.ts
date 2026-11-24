import type { Db, ItemRow, SourceRow } from '../db.js';
import { today } from '../dates.js';
import { resolveOwnerQuery } from '../owners.js';

export type State = 'open' | 'done' | 'overdue';

export interface ListedItem extends ItemRow {
  state: State;
  sources: SourceRow[];
}

export interface ListOptions {
  owner?: string;
  /** "open" includes overdue items; "overdue" is the open ones past their due date. */
  status?: State;
  dueBefore?: string;
  today?: string;
}

export function list(db: Db, opts: ListOptions = {}): ListedItem[] {
  const now = opts.today ?? today();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (opts.owner) {
    where.push('owner_key = ?');
    params.push(resolveOwnerQuery(db, opts.owner));
  }
  if (opts.status === 'done') where.push("status = 'done'");
  if (opts.status === 'open') where.push("status = 'open'");
  if (opts.status === 'overdue') {
    where.push("status = 'open' AND due_date IS NOT NULL AND due_date < ?");
    params.push(now);
  }
  if (opts.dueBefore) {
    where.push('due_date IS NOT NULL AND due_date < ?');
    params.push(opts.dueBefore);
  }

  const sql = `SELECT * FROM items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY status = 'done', due_date IS NULL, due_date, id`;
  const rows = db.prepare(sql).all(...params) as unknown as ItemRow[];
  const sourcesOf = db.prepare('SELECT * FROM item_sources WHERE item_id = ? ORDER BY meeting_date, file_path');

  return rows.map(r => ({
    ...r,
    state: stateOf(r, now),
    sources: sourcesOf.all(r.id) as unknown as SourceRow[],
  }));
}

export function stateOf(r: Pick<ItemRow, 'status' | 'due_date'>, now: string): State {
  if (r.status === 'done') return 'done';
  return r.due_date && r.due_date < now ? 'overdue' : 'open';
}
