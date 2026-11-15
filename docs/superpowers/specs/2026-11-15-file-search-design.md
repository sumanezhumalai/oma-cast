# Design Spec: Files & Folders Search Module for omacast

**Date:** 2026-11-15  
**Author:** Antigravity / Suman  
**Target:** `oma-cast` (plugin `typecraft.omacast` on Omarchy Linux)  
**Status:** Approved  

---

## 1. Objective

Provide a fast, bounded, resource-efficient "Files & Folders" search module with live preview for `omacast` (Raycast on Omarchy), matching the speed and ranking semantics of `omarchy-spotlight` while preserving absolute module isolation for effortless synchronization with upstream (`typecraft-dev/oma-cast`).

---

## 2. Core Constraints & Guiding Principles

1. **Clean-Room & Native Omarchy Runtime:**
   - Runs inside `omarchy-shell` (Quickshell).
   - Zero heavy background indexers (no SQLite FTS daemon, no constant inotify filesystem crawl).
   - Uses `fd` (fd-find) for fast parallel traversal.
2. **Strict Isolation (Rebase-Friendly):**
   - Core ranking logic lives in a dedicated, self-contained file (`core/FileRank.js`).
   - Helper broker script lives in `services/file-helper.py` (or `bin/`).
   - QML service lives in `services/FileSearchService.qml`.
   - Touches existing upstream files only at well-defined integration seams (`BUILTINS` in `RootSearch.js`, `Backend.qml` RPC registry, `splitView` condition in `LauncherWindow.qml`).
3. **Bounded I/O & Heap Safety:**
   - Subprocess execution enforced with a 3.0s deadline (SIGTERM -> SIGKILL).
   - 256 KB stdout byte cap.
   - Max 400 candidate rows returned to QML.
   - 200,000 JSON character budget to prevent Qt/QML heap spikes.
4. **Privacy:**
   - Sensitive directories and credentials (`~/.ssh`, `~/.gnupg`, `~/.aws`, `.env*`, `*.key`, `*.pem`, `*id_rsa*`) have their previews masked (`"Contents hidden for private files"`).
   - Queries and paths are never leaked in process argv where other users could see them.

---

## 3. Architecture & Components

```
┌───────────────────────────────────────────────────────────────────┐
│                      ui/LauncherWindow.qml                        │
│                                                                   │
│   View: { kind: "files", title: "Search Files", query: "" }       │
│   Split View: 40% List (ResultRow.qml) / 60% DetailPane.qml       │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ RPC call: "fileSearch.search"
                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                            Backend.qml                            │
│                                                                   │
│   Rpc.register(backend.registry, "fileSearch", {                  │
│     search: function(data),                                       │
│     getDetail: function(data),                                    │
│     open: function(data),                                         │
│     reveal: function(data)                                        │
│   })                                                              │
└───────────────────┬───────────────────────────┬───────────────────┘
                    │                           │
                    ▼                           ▼
┌─────────────────────────────────────┐  ┌──────────────────────────┐
│    services/FileSearchService.qml   │  │     core/FileRank.js     │
│                                     │  │                          │
│  • Manages 150ms search debounce    │  │  • Name match tiers:     │
│  • Invokes services/file-helper.py  │  │    Exact (6), Prefix (5),│
│  • Streams results to Backend       │  │    Word (4), Substr (3), │
│  • Fetches detail preview           │  │    Acronym (2), Res (1)  │
│                                     │  │  • Prefix gap (200)      │
│                                     │  │  • Depth & hidden penalty│
└───────────────────┬─────────────────┘  └──────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│       services/file-helper.py       │
│                                     │
│  • cmd_files(directory, pattern)    │
│    Runs `fd` with bounds            │
│  • cmd_preview_file(path)           │
│    Reads metadata, folder listing,  │
│    safe text head, image check      │
└─────────────────────────────────────┘
```

---

## 4. Detailed Component Design

### 4.1 `core/FileRank.js`
- **Pure JavaScript:** No Qt Quick dependencies; runs both in QML and Node.js (`module.exports`).
- **Scoring Function:** `rank(list, pattern, searchRoot, maxTerms)`:
  - `list`: Array of `{ id, path, name, dir, isDir }`.
  - Splits pattern into whitespace-delimited terms (up to `maxTerms`, default 8).
  - Evaluates basename match quality for each term (`nameTier`).
  - Combines multiple terms by taking `Math.min(...)` across terms.
  - Computes `pathPenalty(dir, name, searchRoot)`:
    - Segment count relative to `searchRoot` $\times 150$.
    - Hidden ancestor $\times 1500$.
    - Hidden name $\times 500$.
    - Capped at `FILE_TIER_STEP - 1` (9999).
  - Applies `FILE_PREFIX_GAP = 200` to prevent deeply nested exact matches from outranking shallow near-complete typing prefixes.
  - Sorts deterministically by: `score` descending, lowercase path ascending, original path ascending.

### 4.2 `services/file-helper.py`
- Executable Python 3 broker with subcommands:
  1. `files <directory> <pattern>`:
     - Runs: `fd --hidden --follow --one-file-system --ignore-case --exclude .git --exclude node_modules --exclude .cache --max-results 400 [--and <term2> ...] -- <term1> <directory>`
     - Enforces 3.0s deadline and 256 KB buffer limit.
     - Projects results into `{ files: [{ id, path, name, dir, isDir }] }` within 200,000 JSON character budget.
  2. `preview-file <path>`:
     - Stat path for modification time and size.
     - Detects secret/private paths (`~/.ssh`, `~/.gnupg`, `~/.aws`, `.env`, `*.key`, `*.pem`, `*id_rsa*`) -> `{ kind: "hidden", ... }`.
     - For directory: lists up to 200 entries sorted directories first, with icon metadata (`isDir`).
     - For image: verifies MIME `image/*` and size $\le 20\text{ MB}$, returns `{ kind: "image", image: path }`.
     - For text: reads first 32 KB, checks binary (`\x00`), returns `{ kind: "text", text: ..., lines: ... }`.
     - For binary: returns `{ kind: "binary", description: mime }`.

### 4.3 `services/FileSearchService.qml`
- Spawns `file-helper.py` using `Quickshell.Io.Process`.
- Handles asynchronous callback delivery and cancellation.
- Provides search debouncing (150 ms) to avoid thrashing during typing.

### 4.4 `Backend.qml` Integration
- Instantiates `FileSearchService { id: fileSearchService }`.
- Registers RPC namespace `"fileSearch"`:
  - `search`: returns ranked rows via `FileRank.rank`.
  - `getDetail`: formats preview response into `DetailPane` model structure: `{ text, image, info }`.
  - `open`: executes `xdg-open` via `Quickshell.execDetached`.
  - `reveal`: executes file manager open via `xdg-open <dir>`.
- Adds `builtin:search-files` to `BUILTINS` in `core/RootSearch.js`.

### 4.5 `ui/LauncherWindow.qml` & `ui/DetailPane.qml` Integration
- Updates `splitView` condition:
  ```qml
  readonly property bool filesView: window.view.kind === "files"
  readonly property bool splitView: window.clipboardView || window.view.kind === "theme" || window.filesView
  ```
- Binds `detail` in `DetailPane` when `window.filesView` is active to `backend.callSync("fileSearch.getDetail", { path: window.selectedRow.path })`.
- Provides contextual actions in `ActionPanel`:
  - `↵` Open File / Folder
  - `Ctrl+↵` Reveal in File Manager
  - `Ctrl+Shift+C` Copy Path
  - `Ctrl+T` Open in Terminal
