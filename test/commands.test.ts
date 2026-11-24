import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markDone } from '../src/commands/done.js';
import { followup } from '../src/commands/followup.js';
import { ingest } from '../src/commands/ingest.js';
import { list } from '../src/commands/list.js';
import { openDb, type Db } from '../src/db.js';

const TODAY = '2026-11-24';
let db: Db;
let dir: string;

beforeEach(() => {
  db = openDb(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'actiontrack-'));
  cpSync(join(__dirname, 'fixtures/notes'), dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const byTask = (task: string) => list(db, { today: TODAY }).find(i => i.task === task)!;

describe('ingest', () => {
  it('skips malformed notes and reports them without crashing', () => {
    const r = ingest(db, dir);
    expect(r.files).toBe(7);
    expect(r.parsed).toBe(3);
    expect(r.skipped.map(s => s.file).sort()).toEqual([
      'malformed-bad-date.md', 'malformed-bad-yaml.md', 'malformed-empty.md', 'malformed-no-frontmatter.md',
    ]);
  });

  it('merges an item repeated across meetings into one with every source', () => {
    ingest(db, dir);
    const quote = byTask('send the revised quote');
    expect(quote.sources).toHaveLength(3);
    // The latest meeting (Sat 2026-11-21) says "by Friday" -> 2026-11-27
    expect(quote.due_date).toBe('2026-11-27');
  });

  it('flags a reworded item as a possible duplicate instead of merging', () => {
    ingest(db, dir);
    const reworded = byTask('send updated revised quote to Acme');
    expect(reworded.possible_dup_of).toBe(byTask('send the revised quote').id);
  });

  it('marks an item done when a later meeting ticks it', () => {
    ingest(db, dir);
    expect(byTask('book the demo room').status).toBe('done');
  });

  it('stores ambiguous, unknown and unassigned owners', () => {
    const r = ingest(db, dir);
    expect(byTask('review the contract').owner_status).toBe('ambiguous');
    expect(byTask('call legal').owner_status).toBe('unknown');
    expect(byTask('Update the pricing sheet').owner_key).toBe('unassigned');
    expect(r.ambiguous[0].candidates).toEqual(['priya.sharma@acme.com', 'priya.nair@coditas.com']);
  });

  it('is idempotent when re-run on the same folder', () => {
    ingest(db, dir);
    const before = list(db).length;
    const r = ingest(db, dir);
    expect(r.added + r.merged).toBe(0);
    expect(list(db)).toHaveLength(before);
  });

  it('picks up a fixed owner after the note is edited', () => {
    ingest(db, dir);
    const file = join(dir, '2026-11-10-acme-kickoff.md');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Priya to review', 'Priya Nair to review'));
    const r = ingest(db, dir);
    expect(r.removed).toBe(1);
    const fixed = byTask('review the contract');
    expect(fixed.owner_email).toBe('priya.nair@coditas.com');
    expect(list(db).filter(i => i.task === 'review the contract')).toHaveLength(1);
  });

  it('throws for a missing folder', () => {
    expect(() => ingest(db, join(dir, 'nope'))).toThrow(/not a folder/);
  });
});

describe('list', () => {
  beforeEach(() => { ingest(db, dir); });

  it('filters by status, computing overdue from today', () => {
    expect(list(db, { status: 'overdue', today: TODAY }).map(i => i.task)).toEqual(['call legal']);
    expect(list(db, { status: 'done', today: TODAY }).map(i => i.task).sort()).toEqual(['book the demo room', 'share the deck']);
    expect(list(db, { status: 'open', today: TODAY })).toHaveLength(6);
  });

  it('filters by owner email, full name, and rejects a shared first name', () => {
    expect(list(db, { owner: 'priya.sharma@acme.com' })).toHaveLength(2);
    expect(list(db, { owner: 'Priya Sharma' })).toHaveLength(2);
    expect(list(db, { owner: 'rahul' })).toHaveLength(3);
    expect(list(db, { owner: 'unassigned' })).toHaveLength(1);
    expect(() => list(db, { owner: 'Priya' })).toThrow(/more than one owner/);
  });

  it('filters by due date', () => {
    expect(list(db, { dueBefore: '2026-11-28' }).map(i => i.task).sort()).toEqual(['call legal', 'send the revised quote']);
  });
});

describe('done', () => {
  beforeEach(() => { ingest(db, dir); });

  it('marks an item done and rejects bad ids', () => {
    const id = byTask('prepare the security questionnaire').id;
    expect(markDone(db, String(id)).alreadyDone).toBe(false);
    expect(markDone(db, String(id)).alreadyDone).toBe(true);
    expect(() => markDone(db, '999')).toThrow(/no item/);
    expect(() => markDone(db, 'x')).toThrow(/invalid id/);
  });
});

describe('followup', () => {
  beforeEach(() => { ingest(db, dir); });

  it('drafts an email covering open and overdue items', () => {
    const { draft, itemIds } = followup(db, 'Priya Sharma', TODAY);
    expect(itemIds).toHaveLength(2);
    expect(draft!.to).toBe('priya.sharma@acme.com');
    expect(draft!.subject).toBe('Follow-up: 2 open action items');
    expect(draft!.body).toContain('Hi Priya,');
    expect(draft!.body).toContain('- Send the revised quote (due Fri 27 Nov');
    expect(draft!.body).toContain('No due date yet:');
  });

  it('puts overdue items first and in the subject', () => {
    db.prepare("UPDATE items SET due_date = '2026-11-20' WHERE task = 'send the revised quote'").run();
    const { draft } = followup(db, 'priya.sharma@acme.com', TODAY);
    expect(draft!.subject).toContain('(1 overdue)');
    expect(draft!.body.indexOf('Overdue:')).toBeLessThan(draft!.body.indexOf('No due date yet:'));
  });

  it('returns no draft when nothing is open', () => {
    const id = byTask('prepare the security questionnaire').id;
    markDone(db, String(id));
    expect(followup(db, 'rahul@coditas.com', TODAY).draft).toBeNull();
  });

  it('refuses owners without an email', () => {
    expect(() => followup(db, 'Vikram', TODAY)).toThrow(/no email/);
    expect(() => followup(db, 'unassigned', TODAY)).toThrow(/no email/);
  });
});
