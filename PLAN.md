# actiontrack — Implementation Plan

CLI that ingests markdown meeting notes, tracks action items, and drafts follow-up emails (never sends).

## Decisions

| Area | Decision |
|---|---|
| Stack | Node.js 20+ / TypeScript, `commander` (CLI), `better-sqlite3` (storage), `gray-matter` (front-matter), `chrono-node` (relative dates), `vitest` (tests) |
| Storage | SQLite file `~/.actiontrack/actiontrack.db` (override with `ACTIONTRACK_DB`) |
| Note format | YAML front-matter with `date` and `attendees`; action items are `- [ ] ...` / `- [x] ...` lines |
| Due dates | Resolved relative to the **meeting date** (e.g. "by Friday" = first Friday on/after the meeting) |
| Owners | Resolved against the note's attendees list; owner key = email |
| Duplicates | Auto-merge on exact normalized match; flag near-matches (word overlap ≥ 0.6) as "possible duplicate of #id" |
| Missing owner / due | Stored and flagged: owner `unassigned`, due empty (never overdue) |
| Gmail | CLI renders the email from a template (no LLM) and emits JSON; Claude Code relays it with one Gmail MCP `create_draft` call per owner. No send tool is ever used. |
| Token cost | Zero LLM tokens for parsing, dedup, dates, and email text. Only the draft relay uses Claude. |

## Note format

```markdown
---
title: Acme pricing sync
date: 2026-11-20
attendees:
  - Priya Sharma <priya.sharma@acme.com>
  - Priya Nair <priya.nair@coditas.com>
  - Rahul Mehta <rahul@coditas.com>
---
Discussion free text...

- [ ] Priya Sharma to send the revised quote by Friday
- [ ] Rahul to book the demo room by 2026-12-01
- [x] Rahul to share the deck
- [ ] Update the pricing sheet
```

## Data model

`items`
- `id` INTEGER PK
- `owner_email` TEXT NULL (NULL = unassigned)
- `owner_raw` TEXT — name as written in the note
- `owner_status` TEXT — `resolved | ambiguous | unknown | unassigned`
- `task` TEXT — original text with the owner/due-date phrases removed
- `task_norm` TEXT — normalized key used for dedup (indexed with owner)
- `due_date` TEXT NULL (ISO), `due_raw` TEXT NULL
- `status` TEXT — `open | done` (overdue is computed: open and due < today)
- `created_at`, `completed_at`
- `possible_dup_of` INTEGER NULL

`item_sources` — `(item_id, file_path, meeting_date, line_no)`: every note an item appeared in.

`ingest_runs` / `ingest_errors` — per-run report of skipped files and reasons.

## Parsing pipeline (`ingest <folder>`)

1. Glob `*.md` in the folder (non-recursive; `--recursive` flag optional).
2. For each file, inside a try/catch (**a malformed note never crashes the run**):
   - Parse front-matter. Missing or invalid `date`, or no front-matter at all → **skip and report** as malformed.
   - Missing `attendees` → still parse, but owners resolve to `unknown`.
   - Extract checkbox lines with the regex `^\s*[-*]\s*\[( |x|X)\]\s*(.+)$`.
3. For each item line:
   - **Owner:** leading name before ` to ` / `:` / `-` (e.g. "Priya to…", "Priya: …"). Match it against attendees by full name, first name, or email local-part.
     - 1 match → `resolved`
     - 2+ matches (two Priyas) → `ambiguous`, stored and reported with the candidates
     - 0 matches → `unknown` (name kept in `owner_raw`)
     - no name → `unassigned`
   - **Due date:** find a phrase such as `by|before|due|on <expr>` and parse it with `chrono-node` using the meeting date as the reference (forward-looking). If unparseable, due is empty and the item is flagged.
   - **Status:** `[x]` → done.
4. **Dedup:** normalize the text (lowercase, strip punctuation, remove the due phrase and stopwords) to build `task_norm`.
   - Same owner + same `task_norm` → merge: add a source row and keep the existing status (a later `[x]` marks it done).
   - Otherwise compute Jaccard word overlap against the owner's open items. If ≥ 0.6, set `possible_dup_of`.
5. Re-ingesting the same file is idempotent, because the same `(file, line)` source is skipped.
6. Print a report: files parsed, items added, merged, flagged, plus skipped files with reasons and ambiguous owners.

## Commands

- `actiontrack ingest <folder>` — as above.
- `actiontrack list [--owner <name|email|unassigned>] [--status open|done|overdue] [--due-before <date>] [--json]`
  - Table with columns: id, owner, task, due, status, source(s), flags. Overdue items are highlighted.
  - `--owner Priya` matching more than one person → error listing the candidate emails.
- `actiontrack done <id>` — sets status to done with a timestamp. An unknown id → exit code 1 with a message.
- `actiontrack followup <owner> [--json]` — collects that owner's open and overdue items and renders the email from a template:
  - To: owner email; Subject: `Follow-up: N open action items`
  - Body sections: Overdue, Due soon, No due date. Each item shows its source meeting title and date.
  - Output is a JSON payload `{to, subject, body}` (plus a readable preview). Owners that are unresolved or ambiguous → error.
- `actiontrack mcp` (later phase) — optionally exposes the same commands as a local MCP server.

### Gmail draft flow

```
actiontrack followup priya.sharma@acme.com --json   # zero tokens
→ Claude Code: gmail.create_draft(to, subject, body)   # one call, copy as-is
```

Only `create_draft` is ever used, never send. The Gmail connector must be authorized in claude.ai connector settings first.

## Project layout

```
src/
  cli.ts            commander wiring
  db.ts             schema + migrations
  parse/note.ts     front-matter + item extraction
  parse/owner.ts    attendee resolution
  parse/due.ts      chrono-based due resolution
  dedup.ts          normalize + jaccard
  commands/{ingest,list,done,followup}.ts
  email/template.ts
test/
  fixtures/notes/   good, malformed, duplicates, same-first-name, no-owner
  *.test.ts
```

## Milestones

1. Scaffold: TypeScript, commander, SQLite schema, `bin` entry, lint and test setup.
2. Parser: front-matter, items, owners, due dates. Fixtures and unit tests for every edge case.
3. `ingest` with dedup and the report.
4. `list` with filters and overdue computation, then `done`.
5. `followup` template and JSON output; document the Gmail MCP relay in the README.
6. Polish: `--json` everywhere, error messages, README examples.

## Edge-case test matrix

| Case | Expected |
|---|---|
| Same item in 3 meetings | 1 item, 3 sources |
| Reworded item | Separate items, `possible_dup_of` set |
| No owner | Stored as `unassigned`, appears in report |
| No due / unparseable due | Due empty, never overdue |
| Two "Priya"s in attendees, item says "Priya" | Owner `ambiguous`, reported with candidates |
| "Priya Sharma to…" | Resolved to the correct email |
| No front-matter / bad date / binary garbage | File skipped, reason reported, run continues |
| Re-ingest same folder | No new items |
| `[x]` in a later meeting | Existing item marked done |
