import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type Db = DatabaseSync;

export interface ItemRow {
  id: number;
  owner_key: string;
  owner_email: string | null;
  owner_name: string | null;
  owner_raw: string | null;
  owner_status: 'resolved' | 'ambiguous' | 'unknown' | 'unassigned';
  owner_candidates: string | null;
  task: string;
  task_norm: string;
  due_date: string | null;
  due_raw: string | null;
  status: 'open' | 'done';
  created_at: string;
  completed_at: string | null;
  possible_dup_of: number | null;
}

export interface SourceRow {
  item_id: number;
  file_path: string;
  line_no: number;
  meeting_title: string | null;
  meeting_date: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key        TEXT NOT NULL,
  owner_email      TEXT,
  owner_name       TEXT,
  owner_raw        TEXT,
  owner_status     TEXT NOT NULL,
  owner_candidates TEXT,
  task             TEXT NOT NULL,
  task_norm        TEXT NOT NULL,
  due_date         TEXT,
  due_raw          TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  created_at       TEXT NOT NULL,
  completed_at     TEXT,
  possible_dup_of  INTEGER REFERENCES items(id)
);
CREATE INDEX IF NOT EXISTS idx_items_owner_norm ON items(owner_key, task_norm);

CREATE TABLE IF NOT EXISTS item_sources (
  item_id       INTEGER NOT NULL REFERENCES items(id),
  file_path     TEXT NOT NULL,
  line_no       INTEGER NOT NULL,
  meeting_title TEXT,
  meeting_date  TEXT NOT NULL,
  UNIQUE (file_path, line_no)
);

CREATE TABLE IF NOT EXISTS ingest_errors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function defaultDbPath(): string {
  return process.env.ACTIONTRACK_DB ?? join(homedir(), '.actiontrack', 'actiontrack.db');
}

export function openDb(path = defaultDbPath()): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
