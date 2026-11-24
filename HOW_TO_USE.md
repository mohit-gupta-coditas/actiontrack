# How to use actiontrack

actiontrack reads your meeting notes, keeps a list of action items, and writes follow-up emails for you to review.
It never sends email.

This guide works on Windows, macOS and Linux.

---

## 1. One-time setup

### Step 1: Install Node.js

1. Go to https://nodejs.org and download the **LTS** version (22 or newer).
2. Run the installer and keep the default options.
3. Open a **new** terminal and check that it worked:

   ```sh
   node -v
   ```

   You should see `v22.x.x` or higher.

> Terminal = **PowerShell** on Windows, **Terminal** on macOS/Linux.

### Step 2: Install Git

- **Windows:** download it from https://git-scm.com and install it with the default options.
- **macOS:** run `git --version`; if Git is missing, macOS offers to install it.
- **Linux:** `sudo apt install git` (Ubuntu/Debian) or your distro's equivalent.

### Step 3: Download actiontrack

The repository is private, so ask the owner to add you as a collaborator first. Then run:

```sh
git clone https://github.com/mohit-gupta-coditas/actiontrack.git
cd actiontrack
```

If Git asks you to sign in, use your GitHub account. The GitHub CLI also works: `gh auth login`, then `gh repo clone mohit-gupta-coditas/actiontrack`.

### Step 4: Install and build

```sh
npm install
```

This downloads the dependencies and builds the tool, and takes about a minute.

### Step 5: Make the `actiontrack` command available everywhere

```sh
npm link
```

Check that it works:

```sh
actiontrack -v
```

You should see `0.1.0`.

> On **macOS/Linux**, if `npm link` fails with a permission error, run `sudo npm link`.
> If you'd rather not link at all, you can run `npx actiontrack ...` from inside the `actiontrack` folder.

The setup is done.

---

## 2. Write your meeting notes

Put each meeting in its own `.md` file in one folder, for example `~/meeting-notes/`.

Start each file with a short header, then write anything you like:

```markdown
# Meeting: Quote portal kickoff
Date: 2026-09-01
Attendees: Priya Nair, Priya Shah, Rahul Mehta, Anita Desai

## Discussion
Anything you like here: discussion, decisions, etc.

## Action items
- [ ] Priya Nair to send the revised quote to Acme by Friday
- [ ] Rahul: set up the staging environment by 2026-09-08
- [ ] Anita & Rahul to agree on the component API
- [ ] Someone to update the CRM notes
- [x] Rahul to share the deck
```

YAML front-matter (`---` / `date:` / `attendees:` / `---`) also works, if you prefer it.

### The header

- **`Date:`** is required. `2026-09-01`, `9 September 2026` and `Monday, 14 September 2026` all work.
  - Vague dates such as "sometime last week" are rejected, and that note is skipped.
- **`Attendees:`** is a comma-separated list of full names. Owners are matched against this list.
  - If a note has no attendees line, owners are matched against everyone seen in your other notes.

### Action items

- **Format:** a line starting with `- [ ]` (open) or `- [x]` (done). `* [ ]` and `+ [ ]` also work.
- **Owner:** start the line with the person's name, then `to`, `will`, `should`, `must` or `:`.
  - `Priya Nair to …`, `Priya N. to …` and `@priya: …` all work.
  - If two attendees share a first name (two Priyas), write the **full name** or an initial. A bare "Priya" is reported as ambiguous.
  - `Anita & Rahul to …` creates one item for each person.
  - `Lena (with Priya) to …` belongs to Lena.
  - `Someone`, `Everyone`, `Team` and `TBD` are stored as unassigned.
- **Due date:** write it naturally, such as `by Friday`, `by 25 Sep`, `next week` or `by 2026-12-01`.
  - It is counted from the meeting date, not from today.
- **Ignored lines:** items inside `> quotes`, code blocks and `<!-- comments -->` are not counted as action items.

### Email addresses: `people.json`

Follow-up emails need an address for each person. Create a file called `people.json` in the **same folder as your notes**:

```json
{
  "Priya Nair": "priya.nair@yourcompany.com",
  "Priya Shah": "priya.shah@yourcompany.com",
  "Rahul Mehta": "rahul.mehta@yourcompany.com"
}
```

- Use the same full names as in your `Attendees:` lines.
- `ingest` reads this file. After editing it, run `ingest` again.
- If someone is missing, `followup` tells you exactly which line to add.

---

## 3. Everyday use

### Load your notes

```sh
actiontrack ingest ~/meeting-notes
```

On Windows, how you write the path depends on your terminal:

- **Git Bash** (prompt ends in `$`): use forward slashes, `actiontrack ingest C:/Users/you/meeting-notes`, or put the path in quotes. Unquoted backslashes are removed by Git Bash.
- **PowerShell / Command Prompt:** `actiontrack ingest C:\Users\you\meeting-notes` works as is.
- **Any terminal:** paths with spaces need quotes: `actiontrack ingest "C:/Users/you/My Notes"`.

- You can run this as often as you like. Already-seen items are not added again.
- Broken notes are skipped and listed under a warning; the rest still load.
- Repeated items across meetings are merged into one.

### See your action items

```sh
actiontrack list                           # everything
actiontrack list --status overdue          # only overdue
actiontrack list --status open             # everything not done (includes overdue)
actiontrack list --owner "Priya Sharma"    # one person (name or email)
actiontrack list --owner unassigned        # items with no owner
actiontrack list --due-before 2026-12-01   # due before a date
```

Each item has an **ID** in the first column. You need the ID to mark the item done.

### Mark something done

```sh
actiontrack done 4
```

Ticking `- [x]` in a note and running `ingest` again also works.

### Draft a follow-up email

```sh
actiontrack followup "Priya Sharma"
```

This shows the email: who it goes to, the subject, and the body listing the person's overdue and open items. **Nothing is sent.**

---

## 4. Put the draft into Gmail (optional, uses Claude)

1. In **claude.ai**, go to **Settings → Connectors** and connect **Gmail** (one time).
2. In Claude Code, inside the `actiontrack` folder, ask:

   > Run `actiontrack followup priya.sharma@acme.com --json` and create a Gmail draft with exactly that to, subject and body. Do not send it.

3. Open Gmail, then **Drafts**. Review the email, edit it if needed, and send it yourself.

---

## 5. Quick reference

| I want to… | Command |
|---|---|
| Load or refresh notes | `actiontrack ingest <folder>` |
| See everything | `actiontrack list` |
| See overdue items | `actiontrack list --status overdue` |
| See one person's items | `actiontrack list --owner "Full Name"` |
| Mark an item done | `actiontrack done <id>` |
| Preview a follow-up email | `actiontrack followup "Full Name"` |
| Get the email as data for Gmail | `actiontrack followup <email> --json` |
| Get help | `actiontrack -h` or `actiontrack list -h` |
| Check the version | `actiontrack -v` |

---

## 6. Updating to the latest version

```sh
cd actiontrack
git pull
npm install
```

Your data is kept. It lives in `.actiontrack` in your home folder, not in the project.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `actiontrack: command not found` / `not recognized` | Run `npm link` again inside the folder, then open a **new** terminal. Or use `npx actiontrack ...` from inside the folder. |
| `node: command not found` | Node.js isn't installed or the terminal is old. Reinstall Node.js and open a new terminal. |
| An error mentioning `node:sqlite` | Your Node.js is too old. Install version 22 or newer. |
| `not a folder: C:UsersYou...` (backslashes missing) | You're in Git Bash. Quote the path or use forward slashes: `C:/Users/you/notes`. |
| `"Priya" matches more than one owner` | Two people share that name. Use the full name or the email: `--owner "Priya Sharma"`. |
| A note is listed under "skipped malformed notes" | Check that it starts with the `---` header block and has `date: YYYY-MM-DD`. |
| `no email address for <name>` | Add `"<name>": "<email>"` to `people.json` in your notes folder, then run `ingest` again. |
| I want to start over | Delete the `.actiontrack` folder in your home directory, then run `ingest` again. |
| I want my data somewhere else | Set `ACTIONTRACK_DB` to a file path before running the commands. |
