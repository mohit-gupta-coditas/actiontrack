import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as chrono from 'chrono-node';
import Table from 'cli-table3';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { markDone } from './commands/done.js';
import { followup } from './commands/followup.js';
import { ingest, type IngestReport } from './commands/ingest.js';
import { list, type ListedItem, type State } from './commands/list.js';
import { isIsoDate, toIsoDate } from './dates.js';
import { openDb, type Db } from './db.js';
import { ExitCode, UsageError, UserError } from './errors.js';
import { ownerLabel } from './owners.js';

/** stdout carries command output (data, results, lists); stderr carries logs, warnings and errors. */
export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const processIo: Io = {
  out: text => process.stdout.write(text),
  err: text => process.stderr.write(text),
};

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export async function run(argv: string[], io: Io = processIo): Promise<number> {
  const out = (line: string) => io.out(`${line}\n`);
  const err = (line: string) => io.err(`${line}\n`);

  // Settings made before .command() are inherited by every subcommand.
  const program = new Command()
    .name('actiontrack')
    .description('Track action items from markdown meeting notes and draft follow-up emails')
    .version(version, '-v, --version', 'show the version')
    .helpOption('-h, --help', 'show usage')
    .configureOutput({ writeOut: io.out, writeErr: io.err })
    .showHelpAfterError('(run with -h for usage)')
    .exitOverride();

  program.command('ingest')
    .description('Parse every .md meeting note in a folder')
    .option('--json', 'print the report as JSON')
    .argument('<folder>', 'folder containing .md meeting notes')
    .action((folder: string, opts: { json?: boolean }) => {
      const report = withDb(db => ingest(db, folder));
      if (opts.json) {
        out(JSON.stringify(report, null, 2));
        return;
      }
      out(formatSummary(report));
      const attention = formatAttention(report);
      if (attention) err(attention);
    });

  program.command('list')
    .description('Show tracked action items')
    .option('--owner <owner>', 'email, full name, unique first name, or "unassigned"')
    .option('--status <status>', 'open | done | overdue ("open" includes overdue)', parseStatus)
    .option('--due-before <date>', 'YYYY-MM-DD or a phrase like "next friday"', parseDate)
    .option('--json', 'print items as JSON')
    .action((opts: { owner?: string; status?: State; dueBefore?: string; json?: boolean }) => {
      const items = withDb(db => list(db, opts));
      if (opts.json) out(JSON.stringify(items, null, 2));
      else if (items.length) out(formatTable(items));
      else err('No matching items.');
    });

  program.command('done')
    .description('Mark an item as done')
    .argument('<id>', 'item id from `actiontrack list`')
    .action((id: string) => {
      const { item, alreadyDone } = withDb(db => markDone(db, id));
      if (alreadyDone) err(`#${item.id} was already done.`);
      else out(`#${item.id} marked done: ${item.task}`);
    });

  program.command('followup')
    .description('Draft a follow-up email for an owner (never sends)')
    .option('--json', 'print {to, subject, body} for the Gmail create_draft call')
    .argument('<owner>', 'email, full name or unique first name')
    .action((owner: string, opts: { json?: boolean }) => {
      const { draft, itemIds } = withDb(db => followup(db, owner));
      if (opts.json) {
        out(JSON.stringify(draft ? { ...draft, itemIds } : { draft: null }, null, 2));
        return;
      }
      if (!draft) {
        err(`Nothing to follow up for ${owner}.`);
        return;
      }
      out(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`);
      err('Preview only; nothing was sent. Use --json to get the payload for a Gmail draft.');
    });

  try {
    await program.parseAsync(argv);
    return ExitCode.Success;
  } catch (e) {
    return exitCodeFor(e, err);
  }
}

function withDb<T>(fn: (db: Db) => T): T {
  const db = openDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function exitCodeFor(e: unknown, err: (line: string) => void): number {
  if (e instanceof CommanderError) {
    // Commander has already written help, version or the error message.
    switch (e.code) {
      case 'commander.helpDisplayed':
      case 'commander.version':
        return ExitCode.Success;
      case 'commander.unknownCommand':
        return ExitCode.NotFound;
      default:
        // Missing/invalid arguments, unknown options, or no command at all.
        return ExitCode.Usage;
    }
  }
  if (e instanceof UsageError) {
    err(`error: ${e.message}`);
    return ExitCode.Usage;
  }
  if (e instanceof UserError) {
    err(`error: ${e.message}`);
    return ExitCode.Error;
  }
  err(`error: ${(e as Error)?.message ?? String(e)}`);
  if (process.env.DEBUG) err(String((e as Error)?.stack));
  return ExitCode.Error;
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
      i.linked.length ? `with ${i.linked.map(id => `#${id}`).join(' ')}` : '',
      i.possible_dup_of ? `dup? #${i.possible_dup_of}` : '',
      !i.due_date && i.state !== 'done' ? 'no due date' : '',
    ].filter(Boolean).join(', ');
    const src = i.sources.length ? basename(i.sources[0].file_path) + (i.sources.length > 1 ? ` +${i.sources.length - 1}` : '') : '';
    table.push([i.id, ownerLabel(i), i.task, i.due_date ?? '', i.state.toUpperCase(), src, flags]);
  }
  return table.toString();
}

function formatSummary(r: IngestReport): string {
  return [
    `Scanned ${r.files} file(s): ${r.parsed} parsed, ${r.skipped.length} skipped.`,
    `Items: ${r.added} added, ${r.merged} merged as duplicates, ${r.completed} newly done, ${r.unchanged} unchanged` +
      (r.removed ? `, ${r.removed} removed (edited out of notes)` : '') + '.',
  ].join('\n');
}

/** Things the user should look at; these are warnings, so they go to stderr. */
function formatAttention(r: IngestReport): string {
  const out: string[] = [];
  const block = (title: string, rows: string[]) => {
    if (rows.length) out.push(`warning: ${title}:`, ...rows.map(s => `  - ${s}`));
  };
  block('skipped malformed notes', r.skipped.map(s => `${basename(s.file)}: ${s.reason}`));
  block('note warnings', r.warnings.map(w => `${w.file}: ${w.message}`));
  block('ambiguous owners (write the full name in the note, then re-ingest)', r.ambiguous.map(a =>
    `#${a.id} "${a.owner}" in ${a.file}:${a.line} could be ${a.candidates.join(' or ')}`));
  block('owners not in attendees', r.unknownOwners.map(u => `#${u.id} "${u.owner}" in ${u.file}:${u.line}`));
  block('unassigned items', r.unassigned.map(u => `#${u.id} "${u.task}" in ${u.file}:${u.line}`));
  block('possible duplicates', r.flagged.map(f => `#${f.id} "${f.task}" looks like #${f.dupOf}`));
  if (r.noDue) out.push(`warning: ${r.noDue} open item(s) have no due date.`);
  return out.join('\n');
}
