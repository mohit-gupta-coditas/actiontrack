# actiontrack

CLI that reads markdown meeting notes, tracks action items, and drafts follow-up emails for review. **It never sends email.**

Parsing, due-date resolution, duplicate detection and the email text are plain code, so they use no LLM and cost zero tokens.

## Setup

Requires Node.js 22.13+ (it uses the built-in `node:sqlite`, so there is no native build).

```sh
npm install
npm run build
npm link          # makes `actiontrack` available on your PATH
```

Data is stored in `~/.actiontrack/actiontrack.db`. Set `ACTIONTRACK_DB=/path/to/file.db` to use another location.

## Note format

```markdown
---
title: Acme kickoff
date: 2026-11-10
attendees:
  - Priya Sharma <priya.sharma@acme.com>
  - Rahul Mehta <rahul@coditas.com>
---
Free text...

- [ ] Priya Sharma to send the revised quote by Friday
- [ ] Rahul: book the demo room by 2026-12-01
- [x] Rahul to share the deck
```

- `date` is required (`YYYY-MM-DD`). `attendees` can be a list or a comma-separated string.
- The owner is the leading name, written as `Name to|will|should|must …` or `Name: …`.
- The due date is any date phrase, such as `by Friday`, `before Dec 3`, `next week` or `2026-12-01`. It is resolved relative to the **meeting date**, looking forward, so "by Friday" in a Friday meeting means that same day.

## Commands

```sh
actiontrack ingest <folder>                      # parse every .md file in the folder
actiontrack list [--owner X] [--status open|done|overdue] [--due-before DATE] [--json]
actiontrack done <id>
actiontrack followup <owner> [--json]            # preview, or the Gmail draft payload
```

- `--owner` accepts an email, a full name, a unique first name, or `unassigned`.
- `--status open` includes overdue items. An item is overdue when it is open and its due date is before today.
- `--due-before` accepts `YYYY-MM-DD` or a phrase like `"next friday"`.

### Conventions

- Arguments are parsed with `commander`. `-h`/`--help` shows usage and `-v`/`--version` shows the version.
- Flags can come before positional arguments (`actiontrack ingest --json notes/`). Everything after `--` is treated as positional (`actiontrack done -- 12`).
- **stdout** carries command output only: tables, results, the email, and JSON. **stderr** carries warnings, status messages and errors. So `--json` output can always be piped straight into another tool.

| Exit code | Meaning |
|---|---|
| 0 | Success (including `-h`, `-v`, and "nothing to follow up") |
| 1 | General error: unknown item id, missing folder, ambiguous or unknown owner |
| 2 | Misuse: unknown option, missing or invalid argument, no command given |
| 127 | Unknown command |
| 130 | Interrupted (Ctrl+C) |

Set `DEBUG=1` to print stack traces for unexpected errors.

## Edge cases

| Situation | Behaviour |
|---|---|
| Same item in several meetings | Merged into one item when owner and normalized text match (case, punctuation, word order and filler words are ignored). The item keeps every source note. A newer meeting's due date replaces the older one. |
| Reworded item (≥ 60% word overlap) | Kept as a separate item and flagged `dup? #id` in `list` and in the ingest report. |
| No owner | Stored as `(unassigned)`; `list --owner unassigned` shows these items. |
| No due date | Stored with an empty due date, so it is never overdue. Followup emails list it under "No due date yet". |
| Two people with the same first name | The owner is resolved through the note's attendees. "Priya Sharma" resolves; plain "Priya" with two Priyas attending is stored as ambiguous and reported. To fix it, write the full name in the note and re-ingest. |
| Name not in attendees | Stored as "not in attendees" and reported. |
| Malformed note (no front-matter, bad YAML, bad date, binary or empty file) | Skipped and listed in the report; the run continues. |
| Re-running ingest | Idempotent. Edited lines are re-processed, ticked `[x]` boxes mark items done, and items removed from notes are deleted. |

## Creating Gmail drafts (via Claude Code + Gmail MCP)

The CLI builds the email itself, so Claude only relays it, which takes a few hundred tokens per draft.

1. Authorize the **Gmail** connector in claude.ai under Settings → Connectors.
2. In Claude Code, ask: *"Run `actiontrack followup priya.sharma@acme.com --json` and create a Gmail draft with exactly that to/subject/body. Do not send."*
3. Review the draft in Gmail and send it yourself.

Only the Gmail `create_draft` tool is used, never a send tool.

## Known limitations

- An item names one owner. "Priya and Rahul to …" is stored as unassigned.
- The email is in English and plain text; edit the sign-off in Gmail before sending.

## Development

```sh
npm test          # vitest
npm run dev -- list
```
