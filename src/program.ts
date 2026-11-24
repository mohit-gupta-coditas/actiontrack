import { Command } from 'commander';

export async function run(argv: string[]): Promise<void> {
  const program = new Command()
    .name('actiontrack')
    .description('Track action items from markdown meeting notes and draft follow-up emails');

  program.command('ingest <folder>').description('Parse every .md meeting note in a folder')
    .action(() => console.log('not implemented'));
  program.command('list').description('Show tracked action items')
    .action(() => console.log('not implemented'));
  program.command('done <id>').description('Mark an item as done')
    .action(() => console.log('not implemented'));
  program.command('followup <owner>').description('Draft a follow-up email for an owner (never sends)')
    .action(() => console.log('not implemented'));

  await program.parseAsync(argv);
}
