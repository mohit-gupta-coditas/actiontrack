import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db, ItemRow } from '../db.js';
import { UserError } from '../errors.js';
import { jaccard, NEAR_DUP_THRESHOLD } from '../dedup.js';
import { parseNote, type Meeting, type ParsedItem, type ParseResult } from '../parse/note.js';
import { ownerKey, type Attendee } from '../parse/owner.js';
import { loadPeople, PEOPLE_FILE } from '../people.js';

export interface IngestReport {
  files: number;
  parsed: number;
  added: number;
  merged: number;
  completed: number;
  unchanged: number;
  removed: number;
  skipped: { file: string; reason: string }[];
  warnings: { file: string; message: string }[];
  flagged: { id: number; dupOf: number; task: string }[];
  ambiguous: { id: number; owner: string; candidates: string[]; file: string; line: number }[];
  unknownOwners: { id: number; owner: string; file: string; line: number }[];
  unassigned: { id: number; task: string; file: string; line: number }[];
  noDue: number;
  people: number;
}

export function ingest(db: Db, folder: string): IngestReport {
  const dir = resolve(folder);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    // "C:Users..." means a Unix-style shell (Git Bash, WSL) swallowed the backslashes of C:\Users\...
    const hint = /^[A-Za-z]:[^\\/]/.test(folder)
      ? '\nhint: your shell removed the backslashes; quote the path ("C:\\Users\\...") or use forward slashes (C:/Users/...)'
      : '';
    throw new UserError(`not a folder: ${folder}${hint}`);
  }

  const report: IngestReport = {
    files: 0, parsed: 0, added: 0, merged: 0, completed: 0, unchanged: 0, removed: 0,
    skipped: [], warnings: [], flagged: [], ambiguous: [], unknownOwners: [], unassigned: [], noDue: 0, people: 0,
  };

  const people = loadPeople(db, dir);
  report.people = people.loaded;
  for (const message of people.warnings) report.warnings.push({ file: PEOPLE_FILE, message });

  const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.md')).sort();
  report.files = files.length;

  const texts = new Map<string, string>();
  const parsed = new Map<string, ParseResult>();
  for (const name of files) {
    try {
      texts.set(name, readFileSync(join(dir, name), 'utf8'));
      parsed.set(name, parseNote(texts.get(name)!));
    } catch (e) {
      parsed.set(name, { ok: false, reason: `cannot read file: ${(e as Error).message}` });
    }
  }

  // Notes without an attendees line are re-parsed against everyone known from the other notes.
  const roster = buildRoster(db, [...parsed.values()]);
  for (const [name, result] of parsed) {
    if (result.ok && result.meeting.attendees.length === 0 && roster.length) {
      parsed.set(name, parseNote(texts.get(name)!, roster));
    }
  }

  const notes: { file: string; meeting: Meeting; items: ParsedItem[] }[] = [];
  for (const [name, result] of parsed) {
    const file = join(dir, name);
    if (!result.ok) {
      report.skipped.push({ file: name, reason: result.reason });
      db.prepare('INSERT INTO ingest_errors (file_path, reason, created_at) VALUES (?, ?, ?)')
        .run(file, result.reason, new Date().toISOString());
      continue;
    }
    for (const message of result.warnings) report.warnings.push({ file: name, message });
    notes.push({ file, meeting: result.meeting, items: result.items });
  }

  // Oldest meeting first, so merges see items in the order they were raised.
  notes.sort((a, b) => a.meeting.date.localeCompare(b.meeting.date) || a.file.localeCompare(b.file));

  const detached = new Set<number>();
  for (const note of notes) {
    db.exec('BEGIN');
    try {
      for (const item of note.items) ingestItem(db, note.file, note.meeting, item, report, detached);
      detachMissingLines(db, note.file, note.items, detached);
      db.exec('COMMIT');
      report.parsed++;
    } catch (e) {
      db.exec('ROLLBACK');
      report.skipped.push({ file: note.file, reason: `database error: ${(e as Error).message}` });
    }
  }
  report.removed = removeOrphans(db, detached);
  return report;
}

function ingestItem(
  db: Db, file: string, meeting: Meeting, item: ParsedItem, report: IngestReport, detached: Set<number>,
): void {
  const now = new Date().toISOString();
  const name = file.split(/[\\/]/).pop()!;

  const seen = db.prepare('SELECT item_id, raw_text FROM item_sources WHERE file_path = ? AND line_no = ? AND slot = ?')
    .get(file, item.line, item.slot) as { item_id: number; raw_text: string } | undefined;
  if (seen && seen.raw_text === item.text) {
    // Already ingested: only pick up a checkbox that was ticked since.
    if (item.done && markDone(db, seen.item_id, now)) report.completed++;
    else report.unchanged++;
    return;
  }
  if (seen) {
    // The line was edited (or lines shifted): detach it and process it like a new line.
    db.prepare('DELETE FROM item_sources WHERE file_path = ? AND line_no = ? AND slot = ?').run(file, item.line, item.slot);
    detached.add(seen.item_id);
  }

  const key = ownerKey(item.owner);
  const existing = item.taskNorm
    ? db.prepare('SELECT * FROM items WHERE owner_key = ? AND task_norm = ? ORDER BY id LIMIT 1')
      .get(key, item.taskNorm) as ItemRow | undefined
    : undefined;

  let id: number;
  if (existing) {
    id = existing.id;
    // Notes are processed oldest-first, so a newer due date means the deadline moved.
    if (item.due.due) {
      db.prepare('UPDATE items SET due_date = ?, due_raw = ? WHERE id = ?').run(item.due.due, item.due.raw, id);
    }
    if (item.done && markDone(db, id, now)) report.completed++;
    report.merged++;
  } else {
    const dupOf = item.taskNorm ? findNearDuplicate(db, key, item.taskNorm) : null;
    const res = db.prepare(`
      INSERT INTO items (owner_key, owner_email, owner_name, owner_raw, owner_status, owner_candidates,
                         task, task_norm, due_date, due_raw, status, created_at, completed_at, possible_dup_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      key,
      item.owner.attendee?.email ?? null,
      item.owner.attendee?.name ?? null,
      item.owner.raw,
      item.owner.status,
      item.owner.candidates.length ? JSON.stringify(item.owner.candidates.map(c => c.email ?? c.name)) : null,
      item.task,
      item.taskNorm,
      item.due.due,
      item.due.raw,
      item.done ? 'done' : 'open',
      now,
      item.done ? now : null,
      dupOf,
    );
    id = Number(res.lastInsertRowid);
    report.added++;

    if (dupOf) report.flagged.push({ id, dupOf, task: item.task });
    if (item.owner.status === 'ambiguous') {
      report.ambiguous.push({
        id, owner: item.owner.raw!, candidates: item.owner.candidates.map(c => c.email ?? c.name), file: name, line: item.line,
      });
    }
    if (item.owner.status === 'unknown') report.unknownOwners.push({ id, owner: item.owner.raw!, file: name, line: item.line });
    if (item.owner.status === 'unassigned') report.unassigned.push({ id, task: item.task, file: name, line: item.line });
    if (!item.due.due && !item.done) report.noDue++;
  }

  db.prepare(`INSERT INTO item_sources (item_id, file_path, line_no, slot, raw_text, meeting_title, meeting_date)
              VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, file, item.line, item.slot, item.text, meeting.title, meeting.date);
}

/** Drops sources for lines (or owner slots) of this file that no longer hold an action item. */
function detachMissingLines(db: Db, file: string, items: ParsedItem[], detached: Set<number>): void {
  const current = new Set(items.map(i => `${i.line}:${i.slot}`));
  const rows = db.prepare('SELECT item_id, line_no, slot FROM item_sources WHERE file_path = ?')
    .all(file) as { item_id: number; line_no: number; slot: number }[];
  for (const r of rows) {
    if (current.has(`${r.line_no}:${r.slot}`)) continue;
    db.prepare('DELETE FROM item_sources WHERE file_path = ? AND line_no = ? AND slot = ?').run(file, r.line_no, r.slot);
    detached.add(r.item_id);
  }
}

/** Everyone listed as an attendee in any note, plus people.json, one entry per full name. */
function buildRoster(db: Db, results: ParseResult[]): Attendee[] {
  const byName = new Map<string, Attendee>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const a of r.meeting.attendees) {
      const key = a.name.toLowerCase();
      if (!byName.has(key) || (a.email && !byName.get(key)!.email)) byName.set(key, a);
    }
  }
  const people = db.prepare('SELECT name, email FROM people').all() as { name: string; email: string }[];
  for (const p of people) {
    const key = p.name.toLowerCase();
    const known = byName.get(key);
    byName.set(key, { name: known?.name ?? p.name, first: p.name.split(/\s+/)[0], email: known?.email ?? p.email });
  }
  return [...byName.values()];
}

/** Deletes items whose every source line was edited away during this run. */
function removeOrphans(db: Db, candidates: Set<number>): number {
  let removed = 0;
  for (const id of candidates) {
    if (db.prepare('SELECT 1 FROM item_sources WHERE item_id = ? LIMIT 1').get(id)) continue;
    db.prepare('UPDATE items SET possible_dup_of = NULL WHERE possible_dup_of = ?').run(id);
    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    removed++;
  }
  return removed;
}

function markDone(db: Db, id: number, now: string): boolean {
  return db.prepare("UPDATE items SET status = 'done', completed_at = ? WHERE id = ? AND status = 'open'")
    .run(now, id).changes > 0;
}

function findNearDuplicate(db: Db, key: string, norm: string): number | null {
  const rows = db.prepare("SELECT id, task_norm FROM items WHERE owner_key = ? AND status = 'open'")
    .all(key) as { id: number; task_norm: string }[];
  let best: { id: number; score: number } | null = null;
  for (const r of rows) {
    const score = jaccard(norm, r.task_norm);
    if (score >= NEAR_DUP_THRESHOLD && (!best || score > best.score)) best = { id: r.id, score };
  }
  return best?.id ?? null;
}
