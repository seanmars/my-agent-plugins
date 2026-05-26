---
name: code-review-to-html
description: Convert a code review markdown report into an interactive HTML viewer with light/dark mode, expand/collapse per issue, per-issue copy, checkboxes that persist via localStorage, and a wrapping left-side TOC. Use whenever the user asks to render, view, present, or convert a code review markdown report (eg report-*.md, cr_*.md, anything with "## P0 — ..." and "### [P0-XX] ..." sections) to HTML, even when they only say "make this easier to read" or "produce the HTML version of the report".
---

# code-review-to-html

Turns a code review markdown report into a self-contained, interactive HTML file. The template ships every feature already wired: light/dark theme toggle, per-issue copy button (id + file + line + description + code + suggestion), expand/collapse per issue (default expanded), checkbox before the id (clicking the whole title row toggles it), and persistence of all expand/collapse + checkbox state via localStorage. The left-side TOC wraps long titles instead of clipping.

## When to invoke

Trigger this skill when the user:
- references a code review report markdown file and asks for an HTML/web/visual version
- asks to render, view, present, or read the report more easily
- pastes the original "use HTML to rewrite this report" prompt or any close variant
- mentions any of: "interactive review", "checklist for review issues", "make the P0/P1 review browsable"

Do not invoke for general markdown -> HTML conversion that has nothing to do with the code review report format.

## Expected input format

The markdown must follow the structure produced by the in-house code review pipeline:

```
# <Report title>

<intro paragraph(s)>

---

## P0 — <label>

### [P0-01] <issue title>

- 檔案: `<path>`
- 行數: <line range>
- 問題描述: <prose>
- 相關程式碼:
  ```csharp
  ...
  ```
- 建議修正:
  ```csharp
  ...
  ```

### [P0-02] ...

## P1 — <label>

### [P1-01] ...

## 審查覆蓋摘要

| ... | ... |
```

The parser keys off `### [P{n}-NN] <title>` for issue blocks and `## P{n} — <label>` for sections. Priorities P0-P3 are supported; unused priorities are auto-hidden from the filter bar. The H1 title, intro paragraph, and any branch name like `` `feature/X` `` are extracted automatically into the document title, main heading, sidebar subline, and the under-title sentence.

## How to convert

Run the bundled script. Python 3.8+ is required; on Windows the launcher is `python` (not `python3`).

```bash
python "<skill-dir>/scripts/convert.py" <input.md> [output.html]
```

- If `output.html` is omitted, the script writes alongside the input with the same stem (eg `report-foo.md` -> `report-foo.html`).
- The script prints the resolved output path on success.
- The script escapes any literal `</script>` inside the markdown so it can be safely embedded in the page.

After the run, open the HTML file directly in a browser. No build step, no server, no external assets beyond Google Fonts.

## Customising the output

For most reports nothing needs changing. If the user requests cosmetic edits (eg different brand wording, different colour accent, extra metadata field):
1. Edit `assets/template.html` directly. The file is the single source of truth for layout and behaviour.
2. Re-run `convert.py` to regenerate the report HTML.

Do not write tweaks into the per-report HTML — they will be lost the next conversion.

## Template internals (read before editing)

The template uses three coordinated parts:
- **CSS variables** in `:root[data-theme="light"]` and `:root[data-theme="dark"]` define every colour. Add new accent colours here rather than hardcoding in selectors.
- **`<script type="text/plain" id="report-md">`** holds the markdown literally; the placeholder token is `__REPORT_MARKDOWN__` (substituted by `convert.py`).
- **The main IIFE** (`<script>(function () { ... })()`) parses the markdown at load time. Key functions:
  - `parseReport(md)` extracts `title`, `intro`, `branch`, `priorityLabels`, `issues`, `summary`.
  - `renderIssues(issues, priorityLabels)` builds the cards + TOC.
  - `populateHeader(parsed)` writes the page title, main heading, sidebar subline, and intro sentence.
  - State persists in `localStorage`: theme uses the single global key `cr-report-theme`; per-issue checked/expanded state is stored under `cr-report` as a nested object keyed by the HTML file's name (derived from `window.location.pathname`), so multiple reports viewed in the same browser keep independent state.

NUL bytes (`\\x00`) inside the IIFE are intentional — they are the placeholder delimiters used by the lightweight markdown renderer to protect code blocks during string substitution. Preserve them when editing.
