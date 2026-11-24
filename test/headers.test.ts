import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { followup } from '../src/commands/followup.js';
import { ingest, type IngestReport } from '../src/commands/ingest.js';
import { list } from '../src/commands/list.js';
import { openDb, type Db } from '../src/db.js';
import { parseNote } from '../src/parse/note.js';

// Fixtures mirror the plain "# Meeting: / Date: / Attendees:" notes used in practice.
const dir = join(__dirname, 'fixtures/headers');
const TODAY = '2026-09-10';
let db: Db;
let report: IngestReport;

beforeEach(() => {
  db = openDb(':memory:');
  report = ingest(db, dir);
});

const tasks = () => list(db, { today: TODAY }).map(i => i.task).sort();
const byTask = (task: string) => list(db, { today: TODAY }).find(i => i.task === task)!;

describe('header-line notes', () => {
  it('reads title, date and attendees from plain header lines', () => {
    const r = parseNote('# Meeting: Incident review: billing\nDate: 2026-09-21\nAttendees: Sam Okafor, Rahul Verma\n');
    expect(r.ok && r.meeting).toEqual({
      title: 'Incident review: billing',
      date: '2026-09-21',
      attendees: [
        { name: 'Sam Okafor', first: 'Sam', email: null },
        { name: 'Rahul Verma', first: 'Rahul', email: null },
      ],
    });
  });

  it('accepts a full written-out date', () => {
    expect(byTask('share the VPN guide').sources[0].meeting_date).toBe('2026-09-14');
    // "by tomorrow" is relative to that meeting date
    expect(byTask('share the VPN guide').due_date).toBe('2026-09-15');
  });

  it('skips notes with a relative or missing date', () => {
    expect(report.skipped).toEqual([
      { file: '2026-09-20-vague.md', reason: 'meeting date "sometime last week" is not a full calendar date' },
      { file: 'untitled.md', reason: expect.stringMatching(/no meeting date/) },
    ]);
  });

  it('ignores items in blockquotes, code fences and HTML comments', () => {
    expect(tasks()).not.toContain('refund everyone');
    expect(tasks()).not.toContain('ignore this code sample');
    expect(tasks()).not.toContain('buy tokens (cut, not agreed)');
    expect(tasks()).not.toContain('do the commented-out thing');
    expect(tasks()).toContain('set up staging'); // "+ [ ]" list marker
  });

  it('resolves "Priya N." by initial and keeps a bare shared first name ambiguous', () => {
    expect(byTask('send the revised quote to Acme').owner_name).toBe('Priya Nair');
    expect(byTask('review the contract').owner_status).toBe('ambiguous');
  });

  it('treats placeholder owners as unassigned', () => {
    expect(byTask('decide on the launch date').owner_key).toBe('unassigned');
    expect(byTask('write the runbook').owner_key).toBe('unassigned');
  });

  it('merges the same person across notes and marks it done from a later note', () => {
    const quote = byTask('send the revised quote to Acme');
    expect(quote.sources).toHaveLength(2);
    expect(quote.status).toBe('done');
  });
});

describe('owner forms', () => {
  it('resolves @mentions', () => {
    expect(byTask('audit colour contrast').owner_name).toBe('Sam Okafor');
  });

  it('ignores a parenthetical helper', () => {
    expect(byTask('collect user feedback').owner_name).toBe('Rahul Mehta');
  });

  it('splits a multi-owner item into linked items, one per owner', () => {
    const copies = list(db, { today: TODAY }).filter(i => i.task === 'agree on the component API');
    expect(copies.map(i => i.owner_name).sort()).toEqual(['Rahul Mehta', 'Sam Okafor']);
    expect(copies[0].linked).toEqual([copies[1].id]);
    expect(copies[0].due_date).toBe(copies[1].due_date);
  });

  it('keeps split items idempotent and independently completable', () => {
    const [first] = list(db, { today: TODAY }).filter(i => i.task === 'agree on the component API');
    db.prepare("UPDATE items SET status = 'done' WHERE id = ?").run(first.id);
    const again = ingest(db, dir);
    expect(again.added + again.merged).toBe(0);
    const states = list(db, { today: TODAY }).filter(i => i.task === 'agree on the component API').map(i => i.status);
    expect(states.sort()).toEqual(['done', 'open']);
  });
});

describe('notes without attendees', () => {
  it('matches owners against people from other notes', () => {
    expect(byTask('rotate the staging credentials').owner_name).toBe('Sam Okafor');
    expect(report.warnings).toContainEqual({
      file: '2026-09-16-standup.md', message: 'no attendees listed; owners matched against people from other notes',
    });
  });

  it('still reports a first name shared by two known people as ambiguous', () => {
    expect(byTask('own the hiring plan').owner_status).toBe('ambiguous');
  });
});

describe('people.json', () => {
  it('loads valid entries and warns about invalid ones', () => {
    expect(report.people).toBe(2);
    expect(report.warnings).toContainEqual({
      file: 'people.json', message: '"Rahul Mehta": "not-an-email" is not an email address, skipped',
    });
  });

  it('supplies the email for follow-ups', () => {
    const { draft } = followup(db, 'Sam Okafor', TODAY);
    expect(draft!.to).toBe('sam.okafor@example.com');
    expect(draft!.body).toContain('Hi Sam,');
  });

  it('lets --owner use an email from people.json', () => {
    expect(list(db, { owner: 'sam.okafor@example.com' }).map(i => i.task)).toContain('share the VPN guide');
  });

  it('explains how to fix a missing email', () => {
    expect(() => followup(db, 'Rahul Mehta', TODAY)).toThrow(/add "Rahul Mehta": "<email>" to people\.json/);
  });
});
