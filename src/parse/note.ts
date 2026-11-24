import matter from 'gray-matter';
import { isIsoDate } from '../dates.js';
import { normalize } from '../dedup.js';
import { resolveDue, type DueResult } from './due.js';
import { parseAttendee, resolveOwner, type Attendee, type OwnerResult } from './owner.js';

export interface Meeting {
  title: string | null;
  date: string;
  attendees: Attendee[];
}

export interface ParsedItem {
  line: number;
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

const ITEM = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;

export function parseNote(text: string): ParseResult {
  try {
    if (text.includes('\u0000')) return { ok: false, reason: 'not a text file' };
    if (!/^﻿?---\r?\n/.test(text)) return { ok: false, reason: 'missing YAML front-matter' };

    let data: Record<string, unknown>;
    try {
      data = matter(text, {}).data;
    } catch (e) {
      return { ok: false, reason: `invalid YAML front-matter: ${(e as Error).message.split('\n')[0]}` };
    }

    const date = toDate(data.date);
    if (!date) return { ok: false, reason: `missing or invalid "date" (expected YYYY-MM-DD)` };

    const warnings: string[] = [];
    const attendees = toAttendees(data.attendees);
    if (attendees.length === 0) warnings.push('no attendees listed; owners cannot be resolved');

    const meeting: Meeting = {
      title: typeof data.title === 'string' ? data.title : null,
      date,
      attendees,
    };

    const lines = text.split(/\r?\n/);
    const bodyStart = lines.indexOf('---', 1) + 1;
    const items: ParsedItem[] = [];
    for (let i = bodyStart; i < lines.length; i++) {
      const m = lines[i].match(ITEM);
      if (!m) continue;
      const owner = resolveOwner(m[2], attendees);
      const due = resolveDue(owner.rest, date);
      const task = due.rest || owner.rest;
      items.push({
        line: i + 1,
        done: m[1] !== ' ',
        text: m[2],
        owner,
        due,
        task,
        taskNorm: normalize(task),
      });
    }
    return { ok: true, meeting, items, warnings };
  } catch (e) {
    return { ok: false, reason: `unexpected parse error: ${(e as Error).message}` };
  }
}

function toDate(v: unknown): string | null {
  // YAML turns an unquoted 2026-11-20 into a UTC Date.
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && isIsoDate(v.trim())) return v.trim();
  return null;
}

function toAttendees(v: unknown): Attendee[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map(parseAttendee)
    .filter((a): a is Attendee => a !== null);
}
