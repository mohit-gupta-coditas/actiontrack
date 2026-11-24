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

Each file must start with this header block:

```markdown
---
title: Acme kickoff
date: 2026-11-10
attendees:
  - Priya Sharma <priya.sharma@acme.com>
  - Rahul Mehta <rahul@coditas.com>
---

Anything you like here: discussion, decisions, etc.

- [ ] Priya Sharma to send the revised quote by Friday
- [ ] Rahul: book the demo room by 2026-12-01
- [ ] Update the pricing sheet
- [x] Rahul to share the deck
```

Rules for the header and action items:

- **`date`** is required, in `YYYY-MM-DD` format.
- **`attendees`** need an email in `<...>` so that follow-up emails know where to go.
- **Action items** are lines starting with `- [ ]` (open) or `- [x]` (done).
- **Owner:** start the item with the person's name, then `to`, `will`, `should`, `must` or `:`.
  - If two attendees share a first name, write the **full name** (e.g. "Priya Sharma to …").
- **Due date:** write it naturally: `by Friday`, `by Dec 3`, `next week`, `by 2026-12-01`.
  - It is counted from the meeting date, not from today.

---

## 3. Everyday use

### Load your notes

```sh
actiontrack ingest ~/meeting-notes
```

On Windows, write the folder path the Windows way: `actiontrack ingest C:\Users\you\meeting-notes`.

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
| `"Priya" matches more than one owner` | Two people share that name. Use the full name or the email: `--owner "Priya Sharma"`. |
| A note is listed under "skipped malformed notes" | Check that it starts with the `---` header block and has `date: YYYY-MM-DD`. |
| `has no email address` for a follow-up | Add that person to the note's `attendees` with `<email>`, then run `ingest` again. |
| I want to start over | Delete the `.actiontrack` folder in your home directory, then run `ingest` again. |
| I want my data somewhere else | Set `ACTIONTRACK_DB` to a file path before running the commands. |
