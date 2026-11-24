import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jaccard, normalize } from '../src/dedup.js';
import { resolveDue } from '../src/parse/due.js';
import { parseNote } from '../src/parse/note.js';
import { parseAttendee, resolveOwner } from '../src/parse/owner.js';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures/notes', name), 'utf8');

const priyaS = parseAttendee('Priya Sharma <priya.sharma@acme.com>')!;
const priyaN = parseAttendee('Priya Nair <priya.nair@coditas.com>')!;
const rahul = parseAttendee('Rahul Mehta <rahul@coditas.com>')!;

describe('parseAttendee', () => {
  it('parses name and email', () => {
    expect(priyaS).toEqual({ name: 'Priya Sharma', first: 'Priya', email: 'priya.sharma@acme.com' });
  });
  it('accepts a bare email or a bare name', () => {
    expect(parseAttendee('rahul@coditas.com')).toMatchObject({ email: 'rahul@coditas.com', first: 'rahul' });
    expect(parseAttendee('Rahul Mehta')).toMatchObject({ name: 'Rahul Mehta', email: null });
  });
});

describe('resolveOwner', () => {
  const attendees = [priyaS, priyaN, rahul];

  it('resolves a full name even when first names collide', () => {
    const r = resolveOwner('Priya Sharma to send the quote', attendees);
    expect(r.status).toBe('resolved');
    expect(r.attendee?.email).toBe('priya.sharma@acme.com');
    expect(r.rest).toBe('send the quote');
  });
  it('marks a shared first name as ambiguous with candidates', () => {
    const r = resolveOwner('Priya to review the contract', attendees);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map(c => c.email)).toEqual(['priya.sharma@acme.com', 'priya.nair@coditas.com']);
  });
  it('resolves a unique first name and the "Name:" form', () => {
    expect(resolveOwner('Rahul: prepare the questionnaire', attendees)).toMatchObject({
      status: 'resolved', rest: 'prepare the questionnaire',
    });
  });
  it('marks a name not in attendees as unknown', () => {
    expect(resolveOwner('Vikram to call legal', attendees)).toMatchObject({ status: 'unknown', raw: 'Vikram' });
  });
  it('marks items without a name as unassigned', () => {
    expect(resolveOwner('Update the pricing sheet', attendees).status).toBe('unassigned');
  });
});

describe('resolveDue', () => {
  it('resolves weekdays relative to the meeting date', () => {
    // 2026-11-10 is a Tuesday -> Friday is 2026-11-13
    expect(resolveDue('send the quote by Friday', '2026-11-10')).toEqual({
      due: '2026-11-13', raw: 'by Friday', rest: 'send the quote',
    });
  });
  it('treats the same weekday as the meeting day itself', () => {
    expect(resolveDue('send by Friday', '2026-11-20').due).toBe('2026-11-20');
  });
  it('parses explicit ISO dates', () => {
    expect(resolveDue('book the room by 2026-12-01', '2026-11-10').due).toBe('2026-12-01');
  });
  it('returns null when there is no date', () => {
    expect(resolveDue('prepare the questionnaire', '2026-11-10')).toEqual({
      due: null, raw: null, rest: 'prepare the questionnaire',
    });
  });
});

describe('dedup', () => {
  it('normalizes away order, punctuation and stopwords', () => {
    expect(normalize('Send the revised quote.')).toBe(normalize('send revised quote'));
  });
  it('scores word overlap', () => {
    expect(jaccard(normalize('send revised quote'), normalize('send updated revised quote to Acme'))).toBeCloseTo(0.6);
    expect(jaccard(normalize('send quote to Acme'), normalize('send invoice to Acme'))).toBe(0.5);
  });
});

describe('parseNote', () => {
  it('parses a well-formed note', () => {
    const r = parseNote(fixture('2026-11-10-acme-kickoff.md'));
    if (!r.ok) throw new Error(r.reason);
    expect(r.meeting).toMatchObject({ title: 'Acme kickoff', date: '2026-11-10' });
    expect(r.meeting.attendees).toHaveLength(3);
    expect(r.items).toHaveLength(5);
    expect(r.items[0]).toMatchObject({ line: 13, done: false, task: 'send the revised quote' });
    expect(r.items[0].due.due).toBe('2026-11-13');
    expect(r.items[4].done).toBe(true);
  });
  it('accepts comma-separated attendees', () => {
    const r = parseNote(fixture('2026-11-17-acme-followup.md'));
    expect(r.ok && r.meeting.attendees.map(a => a.email)).toEqual(['priya.sharma@acme.com', 'rahul@coditas.com']);
  });
  it.each([
    ['malformed-no-frontmatter.md', /front-matter/],
    ['malformed-bad-date.md', /date/],
    ['malformed-bad-yaml.md', /YAML/],
    ['malformed-empty.md', /front-matter/],
  ])('rejects %s without throwing', (file, reason) => {
    const r = parseNote(fixture(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
  it('rejects binary content', () => {
    expect(parseNote('---\u0000\u0001').ok).toBe(false);
  });
});
