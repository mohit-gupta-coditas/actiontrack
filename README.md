# actiontrack

CLI that reads markdown meeting notes, tracks action items, and drafts follow-up emails for review. **It never sends email.**

Parsing, due-date resolution, duplicate detection and the email text are plain code, so they use no LLM and cost zero tokens.

New here? Start with **[HOW_TO_USE.md](HOW_TO_USE.md)**: setup on any laptop and day-to-day use. The design is in [PLAN.md](PLAN.md).

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
# Meeting: Quote portal kickoff
Date: 2026-09-01
Attendees: Priya Nair, Priya Shah, Rahul Mehta

## Action items
- [ ] Priya Nair to send the revised quote by Friday
- [ ] Rahul: set up staging by 2026-09-08
- [x] Rahul to share the deck
```

- **Header:** plain header lines (`Date:` and `Attendees:`) or YAML front-matter (`date:` / `attendees:`).
- **Date:** required. Accepts `YYYY-MM-DD` or a full written date such as `Monday, 14 September 2026`.
- **Owner:** the leading name, written as `Name to|will|should|must …`, `Name: …` or `@name: …`.
- **Due date:** any date phrase, such as `by Friday`, `before Dec 3`, `next week` or `2026-12-01`. It is resolved relative to the **meeting date**, looking forward, so "by Friday" in a Friday meeting means that same day.
- **Emails:** come from `people.json` in the notes folder (`{"Priya Nair": "priya.nair@example.com"}`) or from `Name <email>` attendees.

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
| No owner, or `Someone` / `Everyone` / `Team` / `TBD` | Stored as `(unassigned)`; `list --owner unassigned` shows these items. |
| Several owners (`Anita & Rahul to …`) | One item per owner, linked to each other (`with #id`). Each is done separately and appears in its owner's follow-up. |
| Helper in brackets (`Lena (with Priya) to …`) | Owned by Lena. |
| No due date | Stored with an empty due date, so it is never overdue. Followup emails list it under "No due date yet". |
| Two people with the same first name | Owners are resolved through the note's attendees. "Priya Nair", "Priya N." and `@priya.nair` resolve; a bare "Priya" with two Priyas attending is stored as ambiguous and reported. To fix it, write the full name in the note and re-ingest. |
| Note without an attendees line | Owners are matched against everyone known from other notes and `people.json`, and a warning is shown. |
| Name not in attendees | Stored as "not in attendees" and reported. |
| Items inside `> quotes`, code blocks or `<!-- comments -->` | Ignored; they aren't agreed actions. |
| Malformed note (no date, vague date, bad YAML, binary or empty file) | Skipped and listed in the report; the run continues. |
| Missing email for a follow-up | `followup` exits 1 and says which line to add to `people.json`. |
| Re-running ingest | Idempotent. Edited lines are re-processed, ticked `[x]` boxes mark items done, and items removed from notes are deleted. |

## Creating Gmail drafts (via Claude Code + Gmail MCP)

The CLI builds the email itself, so Claude only relays it, which takes a few hundred tokens per draft.

1. Authorize the **Gmail** connector in claude.ai under Settings → Connectors.
2. In Claude Code, ask: *"Run `actiontrack followup "Priya Nair" --json` and create a Gmail draft with exactly that to/subject/body. Do not send."*
3. Review the draft in Gmail and send it yourself.

Only the Gmail `create_draft` tool is used, never a send tool.

## Known limitations

- Owner resolution is per meeting. A first name shared by two attendees is never guessed.
- The email is in English and plain text; edit the sign-off in Gmail before sending.

## Development

```sh
npm test          # vitest
npm run dev -- list
```
