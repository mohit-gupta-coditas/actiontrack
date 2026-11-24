import type { Db, ItemRow } from '../db.js';
import { UsageError, UserError } from '../errors.js';

export function markDone(db: Db, idArg: string): { item: ItemRow; alreadyDone: boolean } {
  const id = Number(idArg);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`invalid id: ${idArg} (expected a positive integer)`);

  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!item) throw new UserError(`no item with id ${id}`);
  if (item.status === 'done') return { item, alreadyDone: true };

  const now = new Date().toISOString();
  db.prepare("UPDATE items SET status = 'done', completed_at = ? WHERE id = ?").run(now, id);
  return { item: { ...item, status: 'done', completed_at: now }, alreadyDone: false };
}
