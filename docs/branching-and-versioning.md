# Branching and versioning

How this fork stays in sync with upstream, where your own changes live, and how
version numbers work.

## What this repository is

This is a **fork** of [`typecraft-dev/oma-cast`](https://github.com/typecraft-dev/oma-cast):

| Remote | URL | Role |
|---|---|---|
| `origin` | `https://github.com/sumanezhumalai/oma-cast` | Your fork. You push branches here. |
| `upstream` | `https://github.com/typecraft-dev/oma-cast` | The real project. Source of truth. Read-only. |

One-time setup, if the remotes are ever lost:

```sh
git remote add upstream https://github.com/typecraft-dev/oma-cast.git
git remote set-url origin https://github.com/sumanezhumalai/oma-cast.git
```

Upstream's default branch is `main`, and **every push to it reaches marketplace
users on their next `omarchy plugin update`**. That is why `main` is treated as
read-only here: it is the copy you sync from, not the place you work.

Upstream also keeps long-lived branches `marketplace` and `site`. They trail
`main` by many commits and exist to publish the plugin listing and the website.
Never branch off them, and never open a PR against them.

## The one rule

> `main` is a mirror of `upstream/main`. It never carries your commits.

Keep `main` reachable by a fast-forward alone:

```sh
git switch main
git fetch upstream --prune
git merge --ff-only upstream/main
git push origin main
```

If `--ff-only` refuses, `main` has local commits. Move them to a branch
(`git branch stray`, then `git reset --hard upstream/main`) instead of merging.

Set this once so an accidental `git pull` can never create a merge commit:

```sh
git config pull.ff only
```

## Which branch to use

All work starts from `upstream/main`, in a short-lived branch. The prefix says
where the branch is meant to end up.

| Branch | For | Upstream PR? | Lifetime |
|---|---|---|---|
| `feat/<topic>` | New behaviour that upstream should have | Yes | Delete after merge |
| `fix/<topic>` | Bug fixes that upstream should have | Yes | Delete after merge |
| `local/<topic>` | Personal changes: your machine, your hardware, your taste | **No, never** | Keep, or delete when you stop wanting it |
| `docs/<topic>` | Documentation, like this file | Optional | Delete after merge |
| `main` | Nothing. Ever. | — | Permanent |

`local/*` is the important one. Keybindings, personal defaults, a tweak for your
keyboard — anything upstream would not want — lives on its own `local/<topic>`
branch and is **never** merged into `main`, `feat/*`, or a PR. If you need
several personal changes at once, keep them as separate `local/*` branches and
install only the one you are using, rather than braiding them into one branch you
can never rebase again.

`feat/*` and `fix/*` must be rebasable onto a moving `upstream/main`. The moment a
branch needs a merge commit to survive, it has become a `local/*` branch.

## Daily loop

```sh
# 1. Sync the mirror
git switch main
git fetch upstream --prune
git merge --ff-only upstream/main
git push origin main

# 2. Branch off the newest upstream, not off your old branch
git switch -c fix/some-bug upstream/main

# ...work, commit...

# 3. Keep up with upstream while you work
git fetch upstream
git rebase upstream/main

# 4. Push the branch (force-with-lease is safe after a rebase)
git push -u origin fix/some-bug
git push --force-with-lease
```

**Rebase, never merge upstream into a branch.** A merge commit from
`upstream/main` makes the PR diff unreadable and makes the next sync conflict
with itself. For `local/*` branches, rebase too — a rebase conflict is upstream
telling you it touched the same lines you did, which is exactly what you need to
know.

Open the PR against `typecraft-dev/oma-cast:main` from
`sumanezhumalai:fix/some-bug`. Keep the branch rebased instead of using GitHub's
"Update branch" button: that button merges.

## Keeping a diff clean and conflict-free

The diff is what upstream reviews, and it is also what determines whether your
`local/*` branches still rebase cleanly six months from now.

- **One purpose per branch, one change per commit.** A branch that fixes a bug
  and reformats a file cannot be rebased cleanly and cannot be reviewed.
- **Short, imperative commit subjects**, matching the repo's existing history:
  `Fix launcher focus on Hyprland 0.56`, not `fixed stuff`.
- **Do not reformat, reflow, or rename files you are not changing.** Whitespace
  churn is the single biggest source of rebase conflicts.
- **Prefer new files over rewrites.** `core/*.js` is one self-contained module per
  file, so most new behaviour lands in a new file and conflicts with nothing.
- **Leave `manifest.json` alone unless your branch is about it.** The plugin id
  `typecraft.omacast`, `kinds`, and `entryPoints` identify the plugin to
  `omarchy-shell` and to the marketplace. Changing the id is a `local/*` change,
  not a `feat/*` change, because every upstream PR would then carry it.
- **Never commit generated output.** `search/target/` and `bin/omacast-search` are
  in `.gitignore` on purpose; rebuilds are not source.
- **Keep personal data out of the repo.** User state lives in `~/.config/omacast/`,
  `~/.local/share/omacast/`, and `~/.local/state/omacast/`, never in the checkout.

Before pushing, check what you are actually sending:

```sh
git log --oneline upstream/main..HEAD   # only your intended commits?
git diff --stat upstream/main...HEAD    # only your intended files?
```

## Testing a branch without disturbing the installed plugin

The plugin directory holds one copy per plugin id, so a development checkout and
a marketplace install cannot coexist: `bin/omacast install` symlinks **this
checkout** into `~/.config/omarchy/plugins/typecraft.omacast`, replacing whatever
is there.

```sh
bin/omacast install   # link this branch into omarchy-shell and reload
bin/omacast dev       # reload on every save while you edit
bin/omacast uninstall # give the slot back
omarchy plugin add https://github.com/typecraft-dev/oma-cast --enable  # or use upstream
```

A symlinked checkout is for development only: `omarchy plugin validate` rejects
symlinks inside a plugin, so do not try to ship that layout.

## Versioning

There are no git tags or GitHub releases; `manifest.json` `version` is the only
release marker, and it is currently `0.1.0`. Bump it in the same commit that
changes behaviour, so a checkout and a running plugin never disagree.

| Bump | When | Example |
|---|---|---|
| patch `0.1.0` → `0.1.1` | A fix, no new commands or settings | Launcher stops stealing focus |
| minor `0.1.0` → `0.2.0` | New command, setting, or capability that old config still satisfies | Add frecency pruning |
| major `0.1.0` → `1.0.0` | A change old config or a saved store cannot survive | Rename a setting, drop a store |

Rules that keep versioning boring:

- **Bump on the branch, never on `main`.** `main` mirrors upstream, whose version
  is whatever upstream chose.
- **Never bump the version to mark a fork.** The plugin id already separates your
  build from upstream's; a version number that drifts upward tells every future
  sync that the file conflicts.
- **Do not tag or publish from the fork.** Upstream publishes. If you ever do
  release your own build, tag `vX.Y.Z` on the release commit and bump
  `manifest.json` in that same commit.
- **`manifest.json` `version` is not the data schema version.** Settings, frecency,
  and the other stores each carry `schemaVersion` in `core/Schema.js`. Raising one
  of those **without** a matching entry in `core/Migrate.js` destroys user data on
  the next start. A migration is a `feat/*` change with its own test, and the
  plugin `version` may then move a minor.
- **Plugin identity is fixed.** `APP` in `core/Paths.js` (`omacast`) names the
  user's directories, so changing the plugin id does not move or lose user state —
  but it does change how the shell registers the plugin. Only do that on a
  `local/*` branch, when you deliberately want your fork and upstream installed
  side by side.

## Checks before pushing

```sh
node --test tests/*.test.js                                  # unit tests
cargo test --locked --manifest-path search/Cargo.toml        # if you touched search/
bin/build-search && node --test tests/search-integration.test.js
for s in bin/omacast bin/build-search tests/smoke.sh tests/native-transport.sh; do bash -n "$s"; done
omarchy plugin validate .
```

`.github/workflows/ci.yml` runs the same set on every push to `main` and on every
pull request. `tests/smoke.sh` needs a live Omarchy session and is not part of CI.

## When it goes wrong

| Situation | Fix |
|---|---|
| Committed to `main` | `git branch stray` then `git reset --hard upstream/main` (drop `stray` once salvaged) |
| Already pushed to `origin/main` | `git reset --hard upstream/main && git push --force-with-lease origin main` |
| Branch full of unrelated changes | `git switch -c feat/part-one upstream/main`, cherry-pick the relevant commits, delete the old branch |
| Rebase conflicts in a `local/*` branch | Rebase onto `upstream/main` and resolve in favour of upstream, then reapply only your intent |
| Fork has drifted far behind | `git fetch upstream && git reset --hard upstream/main` — after pushing any work-in-progress to a branch |
