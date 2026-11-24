import * as chrono from 'chrono-node';
import { toIsoDate } from '../dates.js';

export interface DueResult {
  due: string | null;
  /** The phrase that was recognised, e.g. "by Friday". */
  raw: string | null;
  /** Text with the due phrase removed. */
  rest: string;
}

const LEAD_IN = /\s*\b(?:by|before|due(?:\s+(?:on|by))?|on|until|till|no later than)\s*$/i;

/** Resolves relative dates ("by Friday") against the meeting date, looking forward. */
export function resolveDue(text: string, meetingDate: string): DueResult {
  const [y, m, d] = meetingDate.split('-').map(Number);
  const ref = new Date(y, m - 1, d, 12);
  const results = chrono.parse(text, ref, { forwardDate: true });
  if (results.length === 0) return { due: null, raw: null, rest: text };

  const hit = results[results.length - 1];
  let start = hit.index;
  const leadIn = text.slice(0, start).match(LEAD_IN);
  if (leadIn) start -= leadIn[0].length;

  const raw = text.slice(start, hit.index + hit.text.length).trim();
  const rest = (text.slice(0, start) + text.slice(hit.index + hit.text.length)).replace(/\s{2,}/g, ' ').trim();
  return { due: toIsoDate(hit.start.date()), raw, rest: rest.replace(/[\s,;.]+$/, '') };
}
