export const ExitCode = {
  Success: 0,
  Error: 1,
  Usage: 2,
  NotFound: 127,
  Interrupted: 130,
} as const;

/** A runtime failure the user can act on (missing item, unknown owner, …). Exits 1. */
export class UserError extends Error {}

/** The command was invoked incorrectly (bad argument format, …). Exits 2. */
export class UsageError extends Error {}
