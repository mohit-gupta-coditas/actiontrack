import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDb } from '../src/db.js';

it('migrates a v0.1 database without losing items', () => {
  const dir = mkdtempSync(join(tmpdir(), 'actiontrack-db-'));
  const file = join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_key TEXT NOT NULL, owner_email TEXT,
        owner_name TEXT, owner_raw TEXT, owner_status TEXT NOT NULL, owner_candidates TEXT, task TEXT NOT NULL,
        task_norm TEXT NOT NULL, due_date TEXT, due_raw TEXT, status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL, completed_at TEXT, possible_dup_of INTEGER REFERENCES items(id));
      CREATE TABLE item_sources (item_id INTEGER NOT NULL REFERENCES items(id), file_path TEXT NOT NULL,
        line_no INTEGER NOT NULL, raw_text TEXT NOT NULL, meeting_title TEXT, meeting_date TEXT NOT NULL,
        UNIQUE (file_path, line_no));
      INSERT INTO items (owner_key, owner_status, task, task_norm, created_at)
        VALUES ('unassigned', 'unassigned', 'x', 'x', '2026-01-01');
      INSERT INTO item_sources VALUES (1, 'a.md', 3, '- x', 'A', '2026-01-01');
    `);
    old.close();

    const db = openDb(file);
    expect(db.prepare('SELECT item_id, line_no, slot FROM item_sources').all())
      .toEqual([{ item_id: 1, line_no: 3, slot: 0 }]);
    // Two owners on the same line are now allowed.
    db.prepare("INSERT INTO item_sources VALUES (1, 'a.md', 3, 1, '- x', 'A', '2026-01-01')").run();
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
