# actiontrack

CLI that reads markdown meeting notes, tracks action items, and drafts follow-up emails for review. It never sends email.

See [PLAN.md](PLAN.md) for the design.

## Commands

- `actiontrack ingest <folder>`: parse every `.md` note in the folder.
- `actiontrack list [--owner X] [--status open|done|overdue] [--due-before DATE]`: show tracked items.
- `actiontrack done <id>`: mark an item as done.
- `actiontrack followup <owner>`: build a follow-up email draft (JSON) for the Gmail MCP `create_draft` call.
