import { basename } from 'node:path';
import * as chrono from 'chrono-node';
import Table from 'cli-table3';
import { Command, InvalidArgumentError } from 'commander';
import { markDone } from './commands/done.js';
import { followup } from './commands/followup.js';
import { ingest, type IngestReport } from './commands/ingest.js';
import { list, type ListedItem, type State } from './commands/list.js';
import { isIsoDate, toIsoDate } from './dates.js';
import { openDb } from './db.js';
import { ownerLabel, UserError } from './owners.js';

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name('actiontrack')
    .description('Track action items from markdown meeting notes and draft follow-up emails');

  program.command('ingest <folder>')
    .description('Parse every .md meeting note in a folder')
    .option('--json', 'print the report as JSON')
    .action((folder: string, opts: { json?: boolean }) => {
      const report = ingest(openDb(), folder);
      console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    });

  program.command('list')
    .description('Show tracked action items')
    .option('--owner <owner>', 'email, full name, unique first name, or "unassigned"')
    .option('--status <status>', 'open | done | overdue ("open" includes overdue)', parseStatus)
    .option('--due-before <date>', 'YYYY-MM-DD or a phrase like "next friday"', parseDate)
    .option('--json', 'print items as JSON')
    .action((opts: { owner?: string; status?: State; dueBefore?: string; json?: boolean }) => {
      const items = list(openDb(), opts);
      if (opts.json) console.log(JSON.stringify(items, null, 2));
      else console.log(items.length ? formatTable(items) : 'No matching items.');
    });

  program.command('done <id>')
    .description('Mark an item as done')
    .action((id: string) => {
      const { item, alreadyDone } = markDone(openDb(), id);
      console.log(alreadyDone ? `#${item.id} was already done.` : `#${item.id} marked done: ${item.task}`);
    });

  program.command('followup <owner>')
    .description('Draft a follow-up email for an owner (never sends)')
    .option('--json', 'print {to, subject, body} for the Gmail create_draft call')
    .action((owner: string, opts: { json?: boolean }) => {
      const { draft, itemIds } = followup(openDb(), owner);
      if (!draft) {
        console.log(opts.json ? JSON.stringify({ draft: null }) : `Nothing to follow up for ${owner}.`);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({ ...draft, itemIds }, null, 2));
        return;
      }
      console.log(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}\n`);
      console.log('(Preview only. Run with --json to get the payload for a Gmail draft. Nothing is sent.)');
    });

  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (!(e instanceof UserError) && !(e as NodeJS.ErrnoException).code && !(e as Error).message.startsWith('not a folder')) {
      throw e;
    }
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

function parseStatus(v: string): State {
  if (v === 'open' || v === 'done' || v === 'overdue') return v;
  throw new InvalidArgumentError('expected open, done or overdue');
}

function parseDate(v: string): string {
  if (isIsoDate(v)) return v;
  const d = chrono.parseDate(v, new Date(), { forwardDate: true });
  if (!d) throw new InvalidArgumentError('expected YYYY-MM-DD or a date phrase');
  return toIsoDate(d);
}

function formatTable(items: ListedItem[]): string {
  const table = new Table({
    head: ['ID', 'Owner', 'Task', 'Due', 'Status', 'Source', 'Flags'],
    style: { head: [], border: [] },
    wordWrap: true,
    colWidths: [null, 24, 40, 12, 9, 30, 16] as unknown as number[],
  });
  for (const i of items) {
    const flags = [
      i.possible_dup_of ? `dup? #${i.possible_dup_of}` : '',
      !i.due_date && i.state !== 'done' ? 'no due date' : '',
    ].filter(Boolean).join(', ');
    const src = i.sources.length ? basename(i.sources[0].file_path) + (i.sources.length > 1 ? ` +${i.sources.length - 1}` : '') : '';
    table.push([i.id, ownerLabel(i), i.task, i.due_date ?? '', i.state.toUpperCase(), src, flags]);
  }
  return table.toString();
}

function formatReport(r: IngestReport): string {
  const out = [
    `Scanned ${r.files} file(s): ${r.parsed} parsed, ${r.skipped.length} skipped.`,
    `Items: ${r.added} added, ${r.merged} merged as duplicates, ${r.completed} newly done, ${r.unchanged} unchanged` +
      (r.removed ? `, ${r.removed} removed (edited out of notes)` : '') + '.',
  ];
  const block = (title: string, rows: string[]) => {
    if (rows.length) out.push('', `${title}:`, ...rows.map(s => `  - ${s}`));
  };
  block('Skipped (malformed) notes', r.skipped.map(s => `${basename(s.file)}: ${s.reason}`));
  block('Warnings', r.warnings.map(w => `${w.file}: ${w.message}`));
  block('Ambiguous owners (fix the name in the note, then re-ingest)', r.ambiguous.map(a =>
    `#${a.id} "${a.owner}" in ${a.file}:${a.line} could be ${a.candidates.join(' or ')}`));
  block('Owners not in attendees', r.unknownOwners.map(u => `#${u.id} "${u.owner}" in ${u.file}:${u.line}`));
  block('Unassigned items', r.unassigned.map(u => `#${u.id} "${u.task}" in ${u.file}:${u.line}`));
  block('Possible duplicates', r.flagged.map(f => `#${f.id} "${f.task}" looks like #${f.dupOf}`));
  if (r.noDue) out.push('', `${r.noDue} open item(s) have no due date.`);
  return out.join('\n');
}
