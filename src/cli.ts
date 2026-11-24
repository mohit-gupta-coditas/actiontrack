#!/usr/bin/env node
// node:sqlite prints an ExperimentalWarning on load; hide it so CLI output stays clean.
// Static imports are hoisted, so the real program is loaded dynamically after the filter is in place.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning.message;
  if (msg.includes('SQLite')) return;
  return (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const { run } = await import('./program.js');
await run(process.argv);
