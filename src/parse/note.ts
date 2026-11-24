import * as chrono from 'chrono-node';
import matter from 'gray-matter';
import { isIsoDate, toIsoDate } from '../dates.js';
import { normalize } from '../dedup.js';
import { resolveDue, type DueResult } from './due.js';
import { parseAttendee, resolveOwners, type Attendee, type OwnerResult } from './owner.js';

export interface Meeting {
  title: string | null;
  date: string;
  attendees: Attendee[];
}

export interface ParsedItem {
  line: number;
  /** 0 for the first owner on a line; "Anita & Rahul to …" yields slots 0 and 1. */
  slot: number;
  done: boolean;
  text: string;
  owner: OwnerResult;
  due: DueResult;
  task: string;
  taskNorm: string;
}

export type ParseResult =
  | { ok: true; meeting: Meeting; items: ParsedItem[]; warnings: string[] }
  | { ok: false; reason: string };

// "- [ ] …", "* [x] …", "+ [ ] …". Blockquoted lines ("> - [ ] …") are quotes, not agreed actions.
const ITEM = /^\s*[-*+]\s*\[( |x|X)\]\s*(.+?)\s*$/;
const FENCE = /^\s*(```|~~~)/;

interface Header {
  title: unknown;
  date: unknown;
  attendees: unknown;
  /** Index of the first line after the header. */
  bodyStart: number;
}

/**
 * Accepts either YAML front-matter:
 *   ---\ndate: 2026-11-20\nattendees: [Priya Nair, …]\n---
 * or plain header lines:
 *   # Meeting: Quote portal kickoff\nDate: 2026-09-01\nAttendees: Priya Nair, Rahul Mehta
 */
export function parseNote(text: string, roster: Attendee[] = []): ParseResult {
  try {
    if (text.includes('\u0000')) return { ok: false, reason: 'not a text file' };
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);

    let header: Header;
    if (lines[0]?.trim() === '---') {
      try {
        const { data } = matter(text, {});
        const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
        header = { title: data.title, date: data.date, attendees: data.attendees, bodyStart: end + 1 };
      } catch (e) {
        return { ok: false, reason: `invalid YAML front-matter: ${(e as Error).message.split('\n')[0]}` };
      }
    } else {
      header = readHeaderLines(lines);
    }

    if (header.date === undefined || header.date === null || header.date === '') {
      return { ok: false, reason: 'no meeting date (expected a "Date: YYYY-MM-DD" line or YAML front-matter)' };
    }
    const date = toDate(header.date);
    if (!date) return { ok: false, reason: `meeting date "${String(header.date)}" is not a full calendar date` };

    const warnings: string[] = [];
    const attendees = toAttendees(header.attendees);
    // Without an attendees line, match owners against everyone known from other notes and people.json.
    const pool = attendees.length ? attendees : roster;
    if (attendees.length === 0) {
      warnings.push(roster.length
        ? 'no attendees listed; owners matched against people from other notes'
        : 'no attendees listed; owners cannot be resolved');
    }

    const meeting: Meeting = {
      title: typeof header.title === 'string' && header.title.trim() ? header.title.trim() : null,
      date,
      attendees,
    };

    const items: ParsedItem[] = [];
    for (const { line, content } of bodyLines(lines, header.bodyStart)) {
      const m = content.match(ITEM);
      if (!m) continue;
      const owners = resolveOwners(m[2], pool);
      const due = resolveDue(owners[0].rest, date);
      const task = due.rest || owners[0].rest;
      owners.forEach((owner, slot) => {
        items.push({ line, slot, done: m[1] !== ' ', text: m[2], owner, due, task, taskNorm: normalize(task) });
      });
    }
    return { ok: true, meeting, items, warnings };
  } catch (e) {
    return { ok: false, reason: `unexpected parse error: ${(e as Error).message}` };
  }
}

/** Reads "# Meeting: …", "Date: …" and "Attendees: …" lines before the first section or item. */
function readHeaderLines(lines: string[]): Header {
  const header: Header = { title: undefined, date: undefined, attendees: undefined, bodyStart: 0 };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^##\s/.test(line) || ITEM.test(line)) break;
    header.bodyStart = i + 1;

    const title = line.match(/^#\s+(?:meeting\s*:\s*)?(.+)$/i);
    if (title && header.title === undefined) header.title = title[1];
    const field = line.match(/^(date|attendees|participants)\s*:\s*(.*)$/i);
    if (!field) continue;
    if (field[1].toLowerCase() === 'date') header.date = field[2].trim();
    else header.attendees = field[2];
  }
  return header;
}

/** Body lines with code fences and HTML comments removed; line numbers are 1-based. */
function* bodyLines(lines: string[], start: number): Generator<{ line: number; content: string }> {
  let inFence = false;
  let inComment = false;
  for (let i = start; i < lines.length; i++) {
    let content = lines[i];
    if (!inComment && FENCE.test(content)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Strip comments, which may open and close on this line or span several lines.
    let visible = '';
    while (content) {
      if (inComment) {
        const end = content.indexOf('-->');
        if (end < 0) { content = ''; break; }
        content = content.slice(end + 3);
        inComment = false;
      } else {
        const begin = content.indexOf('<!--');
        if (begin < 0) { visible += content; break; }
        visible += content.slice(0, begin);
        content = content.slice(begin + 4);
        inComment = true;
      }
    }
    if (visible.trim()) yield { line: i + 1, content: visible };
  }
}

function toDate(v: unknown): string | null {
  // YAML turns an unquoted 2026-11-20 into a UTC Date.
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (isIsoDate(s)) return s;
  // "9 September 2026", "Monday, 14 September 2026". Relative phrases ("last week") are rejected.
  const [hit] = chrono.strict.parse(s);
  if (hit && ['day', 'month', 'year'].every(c => hit.start.isCertain(c as 'day'))) return toIsoDate(hit.start.date());
  return null;
}

function toAttendees(v: unknown): Attendee[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\[|\]$/g, '').split(',') : [];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map(parseAttendee)
    .filter((a): a is Attendee => a !== null);
}
