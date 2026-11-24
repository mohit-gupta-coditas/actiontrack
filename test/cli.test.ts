import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/program.js';

const notes = join(__dirname, 'fixtures/notes');
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'actiontrack-cli-'));
  process.env.ACTIONTRACK_DB = join(tmp, 'test.db');
});
afterEach(() => {
  delete process.env.ACTIONTRACK_DB;
  rmSync(tmp, { recursive: true, force: true });
});

async function cli(...args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await run(['node', 'actiontrack', ...args], {
    out: t => { stdout += t; },
    err: t => { stderr += t; },
  });
  return { code, stdout, stderr };
}

describe('help and version', () => {
  it.each([['-h'], ['--help'], ['list', '-h']])('%s prints usage to stdout and exits 0', async (...args) => {
    const r = await cli(...args);
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(r.stdout).toMatch(/^Usage: actiontrack/);
  });

  it.each([['-v'], ['--version']])('%s prints the version and exits 0', async flag => {
    expect(await cli(flag)).toEqual({ code: 0, stdout: '0.1.0\n', stderr: '' });
  });
});

describe('exit codes', () => {
  it('127 for an unknown command', async () => {
    const r = await cli('bogus');
    expect(r.code).toBe(127);
    expect(r.stderr).toMatch(/unknown command 'bogus'/);
  });

  it.each([
    [[], /Usage:/],
    [['list', '--nope'], /unknown option/],
    [['list', '--status', 'x'], /expected open, done or overdue/],
    [['list', '--due-before', 'blah'], /expected YYYY-MM-DD/],
    [['done'], /missing required argument/],
    [['done', 'abc'], /invalid id/],
  ])('2 for misuse: %j', async (args, message) => {
    const r = await cli(...(args as string[]));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
  });

  it.each([
    [['done', '999'], /no item with id 999/],
    [['ingest', 'does-not-exist'], /not a folder/],
    [['followup', 'nobody@example.com', '--json'], /no owner with email/],
  ])('1 for runtime errors: %j', async (args, message) => {
    const r = await cli(...(args as string[]));
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
  });

  it('1 for an ambiguous owner, listing the choices on stderr', async () => {
    await cli('ingest', notes);
    const r = await cli('list', '--owner', 'Priya');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/priya\.sharma@acme\.com/);
  });
});

describe('argument conventions', () => {
  it('accepts flags before positional arguments', async () => {
    const r = await cli('ingest', '--json', notes);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).parsed).toBe(3);
  });

  it('treats everything after -- as positional', async () => {
    await cli('ingest', notes);
    const r = await cli('done', '--', '1');
    expect(r).toMatchObject({ code: 0, stderr: '' });
    expect(r.stdout).toMatch(/^#1 marked done/);
  });
});

describe('output channels', () => {
  it('ingest: summary on stdout, warnings on stderr', async () => {
    const r = await cli('ingest', notes);
    expect(r.stdout).toMatch(/^Scanned 7 file\(s\)/);
    expect(r.stdout).not.toMatch(/warning|malformed/);
    expect(r.stderr).toMatch(/warning: skipped malformed notes/);
    expect(r.stderr).toMatch(/warning: ambiguous owners/);
  });

  it('--json output on stdout is parseable on its own', async () => {
    await cli('ingest', notes);
    for (const args of [['list', '--json'], ['followup', 'Rahul', '--json'], ['ingest', notes, '--json']]) {
      const r = await cli(...args);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }
  });

  it('followup: email on stdout, hint on stderr', async () => {
    await cli('ingest', notes);
    const r = await cli('followup', 'rahul@coditas.com');
    expect(r.stdout).toMatch(/^To: rahul@coditas\.com/);
    expect(r.stdout).not.toMatch(/Preview only/);
    expect(r.stderr).toMatch(/nothing was sent/);
  });

  it('status messages without data go to stderr', async () => {
    await cli('ingest', notes);
    const r = await cli('list', '--due-before', '2000-01-01');
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.stderr).toMatch(/No matching items/);
  });
});
