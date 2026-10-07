---
name: group-commit
description: Git commit skill that splits all uncommitted changes into atomic commits by functionality (issue / feature / fix), down to individual hunks and lines when one file contains changes for several issues, and orders the commits by dependency so every intermediate commit builds and runs. Use this skill whenever the user wants to commit changes, asks to "commit", wants to group or split commits, or says things like "help me commit these changes", "split my commits", "commit by feature", "commit by issue", "organize my commits", "group-commit", or "/group-commit". Always use this skill instead of a plain git commit when the changes might belong to more than one feature or concern.
---

# Group Commit (group-commit)

Turn every uncommitted change into a sequence of atomic commits, one per issue, where:

1. **Grouping is by change, not by file.** If issues 1, 2 and 3 all touched `a.ts`, each commit contains only the hunks/lines of `a.ts` that belong to its issue.
2. **Order follows dependencies.** An earlier commit never depends on anything introduced by a later commit, so checking out any commit in the sequence yields code that builds and runs.

## Ground rules

- **Only the index changes, never the working tree.** Do not run `git checkout`, `git restore`, `git stash`, or edit files to build a commit. The working tree already holds the final state; each commit is assembled in the index. This makes the whole run reversible.
- Record the starting point first: `BASE=$(git rev-parse HEAD)`. To undo everything at any point: `git reset --soft $BASE && git reset -q` (all changes come back as unstaged, nothing is lost).
- Never `git add .` / `git add -A`, never amend, never push, never `--no-verify`.

## Hunk tool

`scripts/hunks.mjs` (next to this file) lists and stages changes at hunk or line granularity. It needs only Node.js (no npm install) and always operates from the repo root.

```bash
node <skill-dir>/scripts/hunks.mjs list [PATH ...]      # unstaged hunks, each with an ID; change lines are numbered
node <skill-dir>/scripts/hunks.mjs stage ID [ID ...]    # stage whole hunks
node <skill-dir>/scripts/hunks.mjs stage ID:1-3,6       # stage only change lines 1-3 and 6 of that hunk
```

- `list` shows index-vs-working-tree diff, so after staging or committing, the remaining changes get **new IDs**. Always `list` again right before `stage`. A stale ID fails with an error; it never stages the wrong thing.
- Line selection: unselected `+` lines are left out, unselected `-` lines stay as context. The unselected part simply remains unstaged for a later commit.
- Files marked `whole-file only` (new, deleted, renamed, binary, untracked) are staged with `git add <path>` / `git rm --cached <path>`. If such a file must be split across issues, use the explicit-content fallback below.

**Explicit-content fallback** (partial new files, or when `git apply` rejects a selection): write the intended content of the file *for this commit* to a temp file **outside the repo**, then put it straight into the index:

```bash
sha=$(git hash-object -w /tmp/partial-a.ts)
git update-index --add --cacheinfo 100644,$sha,src/a.ts   # 100755 for executables
```

## Workflow

Follow the steps in order. Do not skip the plan review.

### Step 1: Pre-flight

```bash
git status
```

Stop and tell the user if there is a merge/rebase/cherry-pick in progress, unresolved conflicts, or no changes at all. Record `BASE`. Then unstage everything so the index equals HEAD (the working tree is untouched):

```bash
git reset -q
```

### Step 2: Inventory change units

```bash
node <skill-dir>/scripts/hunks.mjs list
```

Each hunk is a candidate **change unit**. Read the diff and, where needed, the surrounding code in the working tree. If a single hunk mixes changes from different issues (e.g. two adjacent edits), split it into line-level units by its numbered lines.

For every unit, note:
- **Purpose**: which issue / feature / fix it serves
- **Provides**: symbols, types, exports, config keys, env vars, schema, files it adds or changes
- **Requires**: symbols etc. it references that do not exist at `BASE`
- **Removes**: symbols it deletes or renames

### Step 3: Assign units to issues

If the user named the issues (e.g. "issue1 is X, issue2 is Y"), use those as the groups. Otherwise infer them from intent. Every unit belongs to exactly one group.

Heuristics:
- Tests go with the code they test, unless they are a standalone test-only change
- `package.json` + lockfile → the group that needs the new dependency, or a separate `chore(deps)` group that precedes it
- Docs-only / config-only changes → their own `docs:` / `chore(config):` group unless they are part of a feature
- Prefer smaller groups; but a group must be able to stand on its own (see Step 4)

### Step 4: Order by dependency (critical)

Build a graph between groups. Group X must come **before** group Y when:
- Y **requires** something X **provides** (import, function, type, route, config key, migration, dependency version)
- Y changes a consumer of an interface that X changes
- X **removes or renames** something, and Y updates the remaining users of it → Y must come **no later than** X (the removal cannot land while callers still exist)

Then topologically sort. Check each prefix: "if someone checks out only the first N commits, does every reference resolve?"

When there is a cycle (X needs Y and Y needs X):
1. First look for the shared piece that causes it (e.g. a helper both use) and move it into its own earlier foundation commit (`refactor:` / `feat(core):`).
2. Only if that is impossible, merge the groups into one commit and explain why to the user.

When explicit dependencies are unclear: foundations (types, utilities, interfaces) → config/env → migrations → deps → features → tests/docs.

### Step 5: Write commit messages

Conventional commits: `type(scope): description`. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `chore`, `ci`. Scope is optional. Lowercase, imperative, no trailing period, max ~72 chars. If the repo's recent `git log` clearly uses a different convention, follow the repo instead.

### Step 6: Present the plan

Show the full plan. Mark files that are only partially included and say which part, so the user can see how a shared file is split:

```
📦 Commit Plan — 3 commits (base: 4459273)

── Commit 1 ─────────────────────────────────────
feat(core): add retry helper
  • src/utils/retry.ts          (new)
  • src/a.ts                    (partial: import + retry() wrapper, L3, L40-58)

── Commit 2 ─────────────────────────────────────
fix(api): retry failed token refresh
  • src/a.ts                    (partial: refreshToken(), L72-80)
  • src/b.ts                    (modified)
  ⚠ after Commit 1 — uses retry() introduced there

── Commit 3 ─────────────────────────────────────
feat(ui): show refresh status banner
  • src/a.ts                    (partial: status export, L95-101)
  • src/c.tsx                   (modified)
  • src/c.test.tsx              (new)
```

Then use `AskUserQuestion` with these options:
- `✅ Proceed` → execute
- `✏️ Edit plan` → ask what to adjust (merge/split groups, move a hunk or file, rename a message), update, show again, ask again
- `❌ Cancel` → stop; nothing has been committed and the working tree is unchanged

### Step 7: Execute

For each group in order:

1. `node <skill-dir>/scripts/hunks.mjs list` — IDs have changed since the previous commit; map this group's units to the current IDs by content.
2. Stage: `hunks.mjs stage <ids/lines>` for partial files, `git add <path>` for whole files, `git rm --cached <path>` for deletions (or the explicit-content fallback).
3. Verify the index before committing:
   ```bash
   git diff --cached --stat
   git diff --cached
   ```
   The staged diff must contain this group's changes and **nothing** from other groups. If not, `git reset -q` and restage.
4. `git commit -m "<message>"`. If a pre-commit hook fails or modifies files, stop and report; do not bypass it.

### Step 8: Verify the result

1. **Nothing lost, nothing extra:** `git status` shows no remaining changes from the pool, and `git diff HEAD` is empty for those files. The final commit's tree equals the working tree.
2. **Each intermediate commit is self-consistent.** For every new commit except the last (the last one equals the working tree):
   - Static check (always): for each symbol a commit uses that was introduced in this run, confirm it exists at that commit, e.g. `git grep -n "export function retry" <sha> -- src/`.
   - Build check (when the project has a cheap check command such as a typecheck, `cargo check`, `go build ./...`, `dotnet build`): run it in a throwaway worktree so the main working tree is untouched:
     ```bash
     git worktree add --detach "$TMPDIR/gc-verify" <sha>
     # run the check inside it (install deps if needed and reasonable)
     git worktree remove --force "$TMPDIR/gc-verify"
     ```
     If the check cannot run (missing deps, too slow), say so instead of claiming it passed.
3. If a commit is broken: `git reset --soft $BASE && git reset -q`, fix the plan (usually a missing dependency edge or a unit in the wrong group), and redo.

Finally show `git log --oneline $BASE..HEAD`.

## Edge cases

- **All changes serve one issue:** say so and propose a single commit.
- **A unit really serves two issues** (e.g. one line used by both): put it in the earlier commit in dependency order.
- **Untracked file with code for several issues:** use the explicit-content fallback to commit only the relevant part first; later commits see it as a normal tracked diff.
- **Renamed file:** stage both the deletion and the new path in the same commit.
- **Formatting-only noise mixed into a hunk:** give it its own `style:` commit or attach it to the issue that touched those lines; do not leave it unstaged.
- **No HEAD yet (fresh repo):** the hunk tool needs a base commit; commit whole files by group instead.
