#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning on load; hide it so CLI output stays clean.
// Static imports are hoisted, so the real program is loaded dynamically after the filter is in place.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning.message;
  if (msg.includes('SQLite')) return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

// Ctrl+C: exit 130. An open SQLite transaction is rolled back when the process ends.
process.on('SIGINT', () => process.exit(130));

// `actiontrack list | head` closes stdout early; that is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

const { run } = await import('./program.js');
process.exitCode = await run(process.argv);
