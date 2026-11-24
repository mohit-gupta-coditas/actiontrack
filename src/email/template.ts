import type { ListedItem } from '../commands/list.js';

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

/** Plain-text follow-up email. Deterministic: no LLM involved. */
export function renderFollowup(to: string, name: string | null, items: ListedItem[]): EmailDraft {
  const overdue = items.filter(i => i.state === 'overdue');
  const upcoming = items.filter(i => i.state === 'open' && i.due_date);
  const noDue = items.filter(i => i.state === 'open' && !i.due_date);

  const n = items.length;
  const subject = overdue.length
    ? `Follow-up: ${n} open action item${n === 1 ? '' : 's'} (${overdue.length} overdue)`
    : `Follow-up: ${n} open action item${n === 1 ? '' : 's'}`;

  const lines: string[] = [
    `Hi ${name?.split(/\s+/)[0] ?? 'there'},`,
    '',
    'Here is a quick follow-up on your open action items from recent meetings.',
  ];
  section(lines, 'Overdue', overdue, i => `was due ${pretty(i.due_date!)}`);
  section(lines, 'Upcoming', upcoming, i => `due ${pretty(i.due_date!)}`);
  section(lines, 'No due date yet', noDue, () => null);
  lines.push(
    '',
    'Could you reply with a quick status or a new date for each? Let me know if anything is blocked.',
    '',
    'Thanks,',
  );
  return { to, subject, body: lines.join('\n') };
}

function section(lines: string[], title: string, items: ListedItem[], when: (i: ListedItem) => string | null): void {
  if (items.length === 0) return;
  lines.push('', `${title}:`);
  for (const i of items) {
    const parts = [when(i), meetings(i)].filter(Boolean).join(', ');
    lines.push(`- ${capitalize(i.task)}${parts ? ` (${parts})` : ''}`);
  }
}

function meetings(i: ListedItem): string {
  const seen = new Set<string>();
  for (const s of i.sources) seen.add(`${s.meeting_title ?? 'meeting'} on ${pretty(s.meeting_date)}`);
  return seen.size ? `from ${[...seen].join('; ')}` : '';
}

function pretty(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
