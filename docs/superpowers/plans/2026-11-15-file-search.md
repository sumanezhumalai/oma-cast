# Files & Folders Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a fast, bounded, isolated "Files & Folders" search module with live preview for `oma-cast` modeled on `omarchy-spotlight`, designed for frictionless rebasing with upstream.

**Architecture:** Pure JS ranking logic (`core/FileRank.js`) paired with a bounded, deadline-enforced Python subprocess helper (`services/file-helper.py`) executing `fd`, wrapped by `services/FileSearchService.qml` and exposed to `LauncherWindow.qml` via `Backend.qml` RPC methods.

**Tech Stack:** JavaScript (ES6, dual QML/Node.js compatibility), Python 3 (`fd` broker & safe preview extractor), QML / Quickshell (`Process`, `StdioCollector`), `fd-find`.

**Spec:** [docs/superpowers/specs/2026-11-15-file-search-design.md](file:///home/suman/Projects/plugins/oma-cast/docs/superpowers/specs/2026-11-15-file-search-design.md)

## Global Constraints

- Must run natively within `omarchy-shell` (Quickshell).
- Zero external runtime daemons or background indexers.
- Queries and file text must never appear in process argument vectors (`argv`).
- Helper runs bounded with 3.0s wall-clock deadline, 256 KB buffer limit, and 200,000 JSON character payload cap.
- Pure JS modules in `core/` must be runnable with Node.js `node:test` without transpilation.
- `omarchy plugin validate .` must pass and the repository must contain no symlinks.

## Review Focus

1. **Path Traversal & Secrets Masking:** Sensitive folders (`.ssh`, `.gnupg`, `.aws`, `.env`, private keys) must never show content previews.
2. **Deep Cache Match Hijacking:** Basename exact matches deep in toolchain caches (e.g. `~/.cargo/.../download`) must not outrank near-complete shallow queries (`Download` -> `~/Downloads`).
3. **Payload Truncation & Heap Protection:** Searching a directory with thousands of matches must not exceed the JSON budget or exhaust Quickshell memory.
4. **Binary & Special File Handling:** Pipes, sockets, devices, and binary files must never hang the helper or cause decoding crashes.
5. **Upstream Rebase Isolation:** Edits to existing files (`Backend.qml`, `LauncherWindow.qml`, `RootSearch.js`) must be minimal, self-contained, and clean.

---

### Task 1: Core File Ranking Module (`core/FileRank.js`)

**Files:**
- Create: `core/FileRank.js`
- Test: `tests/filerank.test.js`

**Interfaces:**
- Consumes: None (pure JS).
- Produces: `FileRank.rank(list, pattern, searchRoot, maxTerms)` -> Array of ranked file objects.
  `FileRank.nameTier(name, term)` -> Integer tier (1..6).
  `FileRank.pathPenalty(dir, name, searchRoot)` -> Integer penalty score.

- [ ] **Step 1: Write the failing unit test** in `tests/filerank.test.js`
  Test match tiers (Exact=6, Prefix=5, Word=4, Substring=3, Acronym=2, Residual=1), prefix gap behavior, depth penalties, hidden directory penalties, and deterministic tie-breaking.

- [ ] **Step 2: Run test to verify it fails**
  Run: `deno test --allow-read tests/filerank.test.js` (or `node --test tests/filerank.test.js` when available).
  Expected: FAIL with "FileRank not found" or "Cannot find module".

- [ ] **Step 3: Implement `core/FileRank.js`**
  Implement tiering, scoring, penalty calculations, and export via `if (typeof module !== "undefined") module.exports = ...`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `deno test --allow-read tests/filerank.test.js` (or node runner).
  Expected: PASS all assertions.

---

### Task 2: Bounded Helper Broker (`services/file-helper.py`)

**Files:**
- Create: `services/file-helper.py`
- Test: `tests/file-helper.test.js`

**Interfaces:**
- Consumes: `fd` command-line tool, filesystem paths.
- Produces: CLI interface:
  `python3 services/file-helper.py files <directory> <pattern>` -> JSON `{ ok: true, files: [...] }`
  `python3 services/file-helper.py preview <path>` -> JSON `{ ok: true, kind: "...", modified: "...", size: ..., ... }`

- [ ] **Step 1: Write integration test** in `tests/file-helper.test.js`
  Test `files` query with single and multiple terms (`--and`), secret directory masking (`.ssh`, `.env`), text file head extraction, image detection, directory entry listing, and binary detection.

- [ ] **Step 2: Run test to verify it fails**
  Run test script.
  Expected: FAIL with file not found.

- [ ] **Step 3: Implement `services/file-helper.py`**
  Implement `cmd_files` and `cmd_preview_file` with bounded process execution, 3.0s deadline, 256 KB buffer limit, and JSON character budget (200k). Make file executable (`chmod +x`).

- [ ] **Step 4: Run test to verify it passes**
  Run: test script.
  Expected: PASS all assertions.

---

### Task 3: QML File Search Service (`services/FileSearchService.qml`)

**Files:**
- Create: `services/FileSearchService.qml`

**Interfaces:**
- Consumes: `services/file-helper.py` via `Quickshell.Io.Process`.
- Produces: QML API:
  `function search(directory, pattern, callback)`
  `function preview(path, callback)`
  `function cancel()`

- [ ] **Step 1: Implement `services/FileSearchService.qml`**
  Set up `Process` execution with `StdioCollector`, 150 ms debounce timer, error handling, and JSON payload deserialization.

- [ ] **Step 2: Verify QML syntax**
  Run `omarchy plugin validate .` to ensure valid QML and no syntax errors.

---

### Task 4: Backend Registration & Built-in Command

**Files:**
- Modify: `core/RootSearch.js` (add `builtin:search-files` to `BUILTINS`)
- Modify: `Backend.qml` (instantiate `FileSearchService` and register `fileSearch.*` RPC methods)
- Test: `tests/rootsearch.test.js`

**Interfaces:**
- Consumes: `services/FileSearchService.qml`, `core/FileRank.js`.
- Produces: RPC namespace `"fileSearch"`:
  `fileSearch.search({ directory, pattern })`
  `fileSearch.getDetail({ path })`
  `fileSearch.open({ path })`
  `fileSearch.reveal({ path })`

- [ ] **Step 1: Add `builtin:search-files` to `core/RootSearch.js`**
  Add command with title "Search Files", subtitle "File Search", glyph `\uf07b` (folder), keywords `["file", "files", "folder", "directory", "search"]`, and run action `{ push: { kind: "files", title: "Search Files" } }`.

- [ ] **Step 2: Register `"fileSearch"` RPC methods in `Backend.qml`**
  Add `FileSearchService { id: fileSearchService }` and register RPC handlers.

- [ ] **Step 3: Run existing root search tests**
  Verify root search tests continue to pass with the new built-in.

---

### Task 5: UI & DetailPane Integration (`ui/LauncherWindow.qml`)

**Files:**
- Modify: `ui/LauncherWindow.qml`

**Interfaces:**
- Consumes: `"fileSearch"` RPC methods, `DetailPane.qml`.
- Produces: Interactive split view for file search, selection, and action panel bindings.

- [ ] **Step 1: Update split-view condition in `ui/LauncherWindow.qml`**
  Add `readonly property bool filesView: window.view.kind === "files"`.
  Extend `splitView: window.clipboardView || window.view.kind === "theme" || window.filesView`.

- [ ] **Step 2: Bind file detail preview**
  When `window.filesView` is active, fetch detail preview via `fileSearch.getDetail` and pass it to `DetailPane`.

- [ ] **Step 3: Define file actions**
  Configure `↵` (Open), `Ctrl+↵` (Reveal), `Ctrl+Shift+C` (Copy Path), and `Ctrl+T` (Open in Terminal).

---

### Task 6: Full Verification & Validation

**Files:**
- All modified and created files.

- [ ] **Step 1: Run all unit and integration tests**
  Verify zero regressions across existing tests and complete pass of file search tests.

- [ ] **Step 2: Run `omarchy plugin validate .`**
  Ensure compliance with Omarchy plugin specs (no forbidden symlinks, valid JSON manifest).

- [ ] **Step 3: Bash syntax checks**
  Run: `for s in bin/omacast bin/build-search tests/smoke.sh; do bash -n "$s"; done`.
