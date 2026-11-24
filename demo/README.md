# Demo

Three sample meetings for the actiontrack team, plus one broken note, covering the main edge cases:

| Case | Where |
|---|---|
| Same item in two meetings (merged) | "review the parsing rules" in the 10 and 17 Nov notes |
| Two owners on one line (split, linked) | "Gaurav & Darshan to agree on the demo script" |
| Placeholder owner (unassigned) | "Someone to book the demo room" |
| Ticked in a later meeting (done) | "Mohit to share the sample meeting notes" |
| Quoted idea (ignored) | `> - [ ] Darshan to present…` in the 23 Nov note |
| Written-out date | `Date: Monday, 23 November 2026` |
| Malformed note (skipped and reported) | `draft-without-date.md` |
| Emails from `people.json` | Gaurav Tupe, Darshan Deshmukh |

## Run it

Use a separate database so the demo doesn't mix with your real items:

```sh
export ACTIONTRACK_DB=demo/demo.db        # PowerShell: $env:ACTIONTRACK_DB = "demo/demo.db"
actiontrack ingest demo/notes
actiontrack list
actiontrack followup "Gaurav Tupe"
actiontrack followup darshan.deshmukh@coditas.com --json
```

`drafts/` holds the `--json` output generated on 24 Nov 2026, ready for a Gmail `create_draft` call.
