import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db.js';

export const PEOPLE_FILE = 'people.json';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Loads `people.json` ({"Full Name": "email", …}) from the notes folder into the people table.
 * Returns warnings instead of throwing, so a bad directory never blocks ingesting notes.
 */
export function loadPeople(db: Db, folder: string): { loaded: number; warnings: string[] } {
  const file = join(folder, PEOPLE_FILE);
  if (!existsSync(file)) return { loaded: 0, warnings: [] };

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { loaded: 0, warnings: [`invalid JSON, ignored: ${(e as Error).message}`] };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { loaded: 0, warnings: ['expected an object like {"Priya Nair": "priya.nair@example.com"}, ignored'] };
  }

  const warnings: string[] = [];
  const upsert = db.prepare(`INSERT INTO people (name_key, name, email) VALUES (?, ?, ?)
                             ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, email = excluded.email`);
  let loaded = 0;
  for (const [name, email] of Object.entries(data)) {
    if (typeof email !== 'string' || !EMAIL.test(email.trim())) {
      warnings.push(`"${name}": "${String(email)}" is not an email address, skipped`);
      continue;
    }
    upsert.run(nameKey(name), name.trim(), email.trim().toLowerCase());
    loaded++;
  }
  return { loaded, warnings };
}

export function emailFor(db: Db, name: string): string | null {
  const row = db.prepare('SELECT email FROM people WHERE name_key = ?').get(nameKey(name)) as { email: string } | undefined;
  return row?.email ?? null;
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
