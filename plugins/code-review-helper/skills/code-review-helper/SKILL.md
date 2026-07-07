---
name: code-review-helper
description: >-
  Generate an interactive, self-contained HTML code-review report (with a
  light/dark theme toggle) that walks the reader through a set of code changes
  as a step-by-step pipeline: what changed, why, the end-to-end impact, and what
  to watch out for. Use this whenever the user asks to review code, review a
  branch / PR / commit / diff, wants a "code review report", a review walkthrough,
  a visual or interactive review, or wants to understand the impact of a set of
  changes — even if they don't say the word "HTML". The review scope is flexible:
  the user can describe exactly what to review, and if they don't, infer a
  sensible scope from git state and confirm it with them before proceeding.
---

# Code Review Helper

Produce a single self-contained HTML file that helps a human review code changes.
The report explains each change as a pipeline (how control/data flows through it),
makes the impact and risks obvious, and uses light interactivity where it
genuinely aids understanding. It ships a light/dark theme toggle.

The goal is a report a reviewer can hand to a teammate and have them understand
the change without reading the raw diff. Correctness of the analysis matters more
than visual polish — never describe behavior you haven't verified in the code.

## Step 1 — Decide the review scope

The scope is whatever set of changes to review. Do not assume "current branch vs main".

**If the user described a scope**, use it. Map their words to a concrete git range or fileset:
- a branch name → `merge-base <branch> main`..`<branch>`
- a PR → fetch it (`gh pr diff <n>`, `gh pr view <n>`) 
- "the last N commits" → `HEAD~N..HEAD`
- "my uncommitted changes" / "what I've been working on" → working tree + staged (`git diff HEAD`)
- "staged" → `git diff --cached`
- specific commits / a path → scope to exactly that

**If the user did not describe a scope**, inspect git state, then propose and confirm.
Gather signals first:
```
git rev-parse --abbrev-ref HEAD
git status --short
git log --oneline main..HEAD        # commits ahead of main (adjust base if main isn't the trunk)
git merge-base HEAD main
```
From those, judge the most likely intent and **ask the user with `AskUserQuestion`** —
present the candidate scopes you actually found, e.g.:
- "This branch's commits vs `main`" (when ahead of main) — show the count
- "Uncommitted working-tree changes" (when `git status` is dirty)
- "Just the last commit"

Include the concrete numbers (how many commits, how many dirty files) in the option
descriptions so the choice is informed. Only skip the question if there's exactly one
plausible scope (e.g. a single dirty file and no commits ahead) — then state the scope
you picked and proceed.

**"My recent work" means a git range, NOT "files I touched lately".** A vague prompt
like "review my recent work" resolves to the branch's own commits vs main (or another
concrete range) — never to "files recently modified across the repo" or "everything by
this author". Those pull in unrelated changes from other merged branches and produce a
report about code that isn't in scope. Whatever range you settle on, it must be one
`git` range you can name; the file list comes from that range and nothing else (Step 2).

## Step 2 — Gather the diff and verify against real code

1. **Pin the canonical file list first.** Run `git diff --name-only <range> -- . ':(exclude)*.meta'`
   and treat that exact set as the review scope. The report must render **exactly these
   files — no more, no less**. Do not add files you happened to read for context, and do
   not drop files because they seem minor. If a file is in this list it gets a `.prdiff`;
   if it is not in this list it does not appear as a reviewed change. This is the single
   guard against scope drift (reviewing unrelated changes) and against silent omission.
2. Get the full diff for the scope: `git diff <range> -- . ':(exclude)*.meta'`.
3. **Read the surrounding code, don't just trust the diff.** For every claim the
   report will make, verify it against the source:
   - Does a called overload/signature actually exist? (grep the definition)
   - Does an enum have exactly the values the logic assumes? (read the enum)
   - Is a "refactor" truly behavior-preserving? (enumerate inputs, compare old vs new)
   - Is a field/variable now dead, or still used elsewhere?
   This verification is what separates a useful review from a plausible-sounding one.
   When you assert equivalence or safety, you should have checked it.

## Step 3 — Analyze

- **Group changes into logical "stories."** A branch often bundles independent
  themes (e.g. a security fix + an unrelated UI tweak). Separating them makes the
  review far clearer than a file-by-file dump.
- **Trace each story as a pipeline**: entry point → transformations → effect. The
  reader should see how a change propagates end to end.
- **Find the risks**, ranked by severity. Look hard at trust boundaries, fail-open
  defaults, implicit contracts (e.g. a cache that must be kept in sync), edge cases
  (empty lists, negative indices, exact-string environment checks), and
  inconsistencies with sibling code.
- Note what's done well too — a review isn't only complaints.

## Step 4 — Build the HTML

Copy `assets/template.html` to the output location and fill it in. The template's
theme toggle and tab navigation work as-is; you write the content.

Suggested tabs (add/drop to fit the change): **總覽 / Overview**, **PR Diff**
(the GitHub/GitLab-style diff), **流水線解說 / Pipeline walkthrough**, **風險與註記
/ Risks & notes**. Add an **互動驗證 / Interactive verification** tab when a
simulator or truth-table earns its place (see below).

Use the template's reusable blocks:
- **Left file navigator** (`nav#filenav`) — auto-built from every `.prdiff` in the
  page; no author markup needed. It lists each changed file with its +/- counts,
  scroll-spies the file currently in view, and clicking an entry jumps to that file.
  Auto-shows on the PR Diff tab on wide viewports; the `📑 檔案` toolbar button toggles
  it anywhere. Just emit the `.prdiff` files and it populates itself.
- **Per-file description** (`.file-desc`, one above each `.prdiff`) — a short block
  telling the reviewer what THIS file's change does and why it matters *before* they
  read the diff. This is the main readability lever; write one per file. Inside it,
  `.related` holds `<a data-jump="<repo path>">` chips linking sibling files — the
  path must match another `.prdiff`'s `data-file`. Clicking a chip jumps to that file
  and reveals a floating **↩ 返回** button that returns the reader to where they were,
  so cross-file checking never loses their place. A `data-jump` path not present in the
  diff renders as a dim, non-clickable chip automatically.
- **PR-style diff** (`.prdiff` with `.row add/del/ctx/hunk` + line-number `.gut`
  cells) — a GitHub/GitLab-like unified diff: file header with +/- counts and
  click-to-collapse, line-number gutters, coloured rows. **Emit the real line
  numbers from the `git diff` hunk headers** (`@@ -o,oc +n,nc @@`) into the `.gut`
  cells and set `data-line` to the new-file line number — this is what the review
  notes anchor to. Put author insight inline via `.anno` and follow a file with a
  `.note-cl` explaining the *why*. This is the primary way to show code now.
- **Review notes** (built into the template, no author work beyond good anchors) —
  in the PR diff the reader **clicks a line number to select one line, Shift-clicks
  another to select a multi-line range**, then attaches one note to that span
  ("this code is wrong / fix like X"). Every risk finding (`li[data-anchor]`) is
  annotatable too. Notes persist in `localStorage`; **export to Markdown embeds the
  file path, the exact line range, AND the selected source lines** (each with its
  line number and +/- marker), followed by the note — so whoever receives it sees
  the problem code and its location without opening the repo. For this to work the
  diff rows must carry real gutter line numbers (see the PR-diff bullet) and each
  `ul.checks li` needs a stable `data-anchor="risk:<slug>"`. This turns the report
  from a read-only explainer into an active review surface — it is the point of the report.
- **Pipeline flow** (`.flow`) — the step-by-step control/data path of a change.
- **Callouts** (`.note-cl`, `.note-cl.ok/.warn/.sec`) — insights, praise, warnings.
- **Risk checklist** (`ul.checks` with `li.good/.watch/.risk`) — ranked findings.

**Interactivity is optional and earns its place.** Add a widget only where "what
happens when…" is a real question the reviewer would ask. Two high-value patterns:
- **Decision simulator** — inputs → a pure JS function mirroring the reviewed logic
  → verdict + step trace. Great for gate/permission/branching code. The JS must be a
  faithful mirror of the actual code, or the sim misleads.
- **Equivalence / truth table** — enumerate all inputs, compare old vs new formula,
  to *prove* a refactor is behavior-preserving. Only valid when the input space is
  small and fully enumerated (e.g. a 4-value enum).
Don't add interactivity for its own sake; a clear diagram beats a gratuitous widget.

Constraints:
- **Self-contained**: all CSS/JS inline, no external requests (works offline).
- **Light/dark**: keep the template's toggle; verify both themes are readable.
- **Language**: match the user's language for all prose (follow their global
  instructions — e.g. Traditional Chinese with half-width punctuation).
- **Escape code in diffs**: `<`, `>`, `&` inside `<code>` must be entity-escaped.

## Step 5 — Output location and hand-off

Default output: `code-review/code-review-{yyyyMMddHHmm}.html` in the repo root
(create the folder; use the current local time, e.g. `code-review-202607071530.html`).
Honor any path the user gave. After writing, sanity-check the file:
- **scope fidelity: the set of `.prdiff data-file` values equals `git diff --name-only
  <range>` (minus filtered files) — no extra files, none missing.** If they differ, the
  review has drifted; fix it before finishing. This is the most important check.
- every `nav data-tab` has a matching `section id`
- no leftover `{{PLACEHOLDER}}` markers
- no dead JS references

Then tell the user the path, briefly summarize the top findings (especially any
high-severity risk), and note the report opens offline in any browser. State
plainly that this is review-only — no source code was changed.
