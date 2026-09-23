#!/usr/bin/env node
/*
List unstaged hunks and stage selected hunks (or selected lines) into the index.

Only the index is modified; the working tree is never touched.

Usage:
  node hunks.mjs list [PATH ...]
  node hunks.mjs stage ID[:LINES] [ID[:LINES] ...]

IDs come from `list`. LINES selects change lines inside a hunk by the numbers
printed by `list`, e.g. `3f2a1c9e:1-3,6`. Unselected `+` lines are dropped and
unselected `-` lines are kept as context, so the rest stays unstaged.
IDs are derived from hunk content: after staging or committing, run `list` again.
PATH arguments are relative to the repository root.
*/

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const USAGE = `Usage:
  node hunks.mjs list [PATH ...]
  node hunks.mjs stage ID[:LINES] [ID[:LINES] ...]`;

const GIT = ["-c", "core.quotepath=off", "--no-pager"];
const DIFF_ARGS = ["diff", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-U3"];
const WHOLE_FILE_MARKERS = ["new file mode", "deleted file mode", "rename from", "copy from", "Binary files", "GIT binary patch"];

function fail(message) {
  process.stderr.write(message + "\n");
  process.exit(1);
}

function runGit(args, input) {
  const proc = spawnSync("git", [...GIT, ...args], { input, maxBuffer: 1024 * 1024 * 1024 });
  if (proc.error) fail(`error: cannot run git: ${proc.error.message}`);
  if (proc.status !== 0) {
    process.stderr.write(proc.stderr);
    process.exit(proc.status ?? 1);
  }
  return proc.stdout;
}

// Split a buffer into lines, each keeping its own line ending
function splitLines(buf) {
  const lines = [];
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(0x0a, start);
    const end = nl === -1 ? buf.length : nl + 1;
    lines.push(buf.subarray(start, end));
    start = end;
  }
  return lines;
}

const startsWith = (line, text) => line.subarray(0, text.length).toString("latin1") === text;
const tagOf = (line) => String.fromCharCode(line[0]);
const decode = (line) => line.toString("utf8").replace(/\r?\n$/, "");

function parsePath(line) {
  // "diff --git a/<path> b/<path>" -> <path>; both sides are identical without renames
  const text = decode(line).slice("diff --git a/".length);
  return text.slice(0, (text.length - 3) / 2);
}

function parseDiff(raw) {
  const files = [];
  let current = null;
  let hunk = null;
  for (const line of splitLines(raw)) {
    if (startsWith(line, "diff --git ")) {
      current = { path: parsePath(line), headLines: [line], hunks: [], wholeFile: false };
      files.push(current);
      hunk = null;
    } else if (current === null) {
      continue;
    } else if (startsWith(line, "@@")) {
      hunk = { header: line, lines: [], id: "" };
      current.hunks.push(hunk);
    } else if (hunk !== null) {
      hunk.lines.push(line);
    } else {
      current.headLines.push(line);
      if (WHOLE_FILE_MARKERS.some((m) => startsWith(line, m))) current.wholeFile = true;
    }
  }

  for (const f of files) {
    const seen = new Map();
    for (const h of f.hunks) {
      const digest = createHash("sha1")
        .update(Buffer.concat([Buffer.from(f.path + "\0"), ...h.lines]))
        .digest("hex")
        .slice(0, 8);
      const count = (seen.get(digest) ?? 0) + 1;
      seen.set(digest, count);
      h.id = count === 1 ? digest : `${digest}${count}`;
    }
  }
  return files;
}

function load(paths = []) {
  return parseDiff(runGit([...DIFF_ARGS, ...(paths.length ? ["--", ...paths] : [])]));
}

function untracked(paths = []) {
  const args = ["ls-files", "--others", "--exclude-standard", "-z", ...(paths.length ? ["--", ...paths] : [])];
  return runGit(args).toString("utf8").split("\0").filter(Boolean);
}

function cmdList(paths) {
  const files = load(paths);
  const out = [];
  for (const f of files) {
    if (f.wholeFile || f.hunks.length === 0) {
      out.push(`== ${f.path}  (whole-file only: stage with git add / git rm --cached)`);
      continue;
    }
    out.push(`== ${f.path}  (${f.hunks.length} hunks)`);
    for (const h of f.hunks) {
      out.push(`[${h.id}] ${decode(h.header)}`);
      let n = 0;
      for (const line of h.lines) {
        const tag = tagOf(line);
        if (tag === "+" || tag === "-") {
          n += 1;
          out.push(`${String(n).padStart(5)} ${decode(line)}`);
        } else {
          out.push(`      ${decode(line)}`);
        }
      }
    }
    out.push("");
  }
  const others = untracked(paths);
  for (const p of others) out.push(`== ${p}  (untracked, whole-file only: stage with git add)`);
  if (files.length === 0 && others.length === 0) out.push("No unstaged changes.");
  process.stdout.write(out.join("\n") + "\n");
}

function parseSelection(spec) {
  const picked = new Set();
  for (const part of spec.split(",")) {
    const [lo, hi] = part.split("-").map(Number);
    if (!Number.isInteger(lo) || (hi !== undefined && !Number.isInteger(hi))) {
      fail(`error: invalid line selection "${spec}"`);
    }
    for (let i = lo; i <= (hi ?? lo); i++) picked.add(i);
  }
  return picked;
}

// Keep only picked change lines; return null when nothing is left to stage
function filterHunk(hunk, picked) {
  const body = [];
  let n = 0;
  let lastKept = true;
  let changed = false;
  for (const line of hunk.lines) {
    const tag = tagOf(line);
    if (tag === "\\") {
      // "\ No newline at end of file" follows its line
      if (lastKept) body.push(line);
      continue;
    }
    if (tag === "+" || tag === "-") {
      n += 1;
      if (picked.has(n)) {
        body.push(line);
        lastKept = true;
        changed = true;
      } else if (tag === "-") {
        body.push(Buffer.concat([Buffer.from(" "), line.subarray(1)]));
        lastKept = true;
      } else {
        lastKept = false;
      }
    } else {
      body.push(line);
      lastKept = true;
    }
  }
  return changed ? body : null;
}

function cmdStage(specs) {
  const byId = new Map();
  for (const f of load()) {
    for (const h of f.hunks) byId.set(h.id, { file: f, hunk: h });
  }

  const selected = new Map(); // path -> { file, picks: [{ hunk, body }] }
  for (const spec of specs) {
    const sep = spec.indexOf(":");
    const hid = sep === -1 ? spec : spec.slice(0, sep);
    const lines = sep === -1 ? "" : spec.slice(sep + 1);
    const found = byId.get(hid);
    if (!found) fail(`error: hunk ${hid} not found (IDs change after staging; run \`list\` again)`);
    const { file, hunk } = found;
    if (file.wholeFile) fail(`error: ${file.path} is whole-file only; use git add`);
    const body = lines ? filterHunk(hunk, parseSelection(lines)) : hunk.lines;
    if (body === null) fail(`error: selection ${spec} contains no change lines`);
    if (!selected.has(file.path)) selected.set(file.path, { file, picks: [] });
    selected.get(file.path).picks.push({ hunk, body });
  }

  const parts = [];
  for (const { file, picks } of selected.values()) {
    picks.sort((a, b) => file.hunks.indexOf(a.hunk) - file.hunks.indexOf(b.hunk));
    parts.push(...file.headLines);
    for (const { hunk, body } of picks) parts.push(hunk.header, ...body);
  }
  const patch = Buffer.concat(parts);

  const apply = ["apply", "--cached", "--recount", "--whitespace=nowarn"];
  runGit([...apply, "--check"], patch);
  runGit(apply, patch);
  for (const [path, { picks }] of selected) {
    process.stdout.write(`staged ${picks.length} hunk(s) of ${path}\n`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "list" && command !== "stage") fail(USAGE);
  // git apply ignores paths outside the cwd, so always work from the repo root
  process.chdir(runGit(["rev-parse", "--show-toplevel"]).toString("utf8").trim());
  if (command === "list") cmdList(args);
  else if (args.length === 0) fail("error: stage needs at least one hunk ID");
  else cmdStage(args);
}

main();
