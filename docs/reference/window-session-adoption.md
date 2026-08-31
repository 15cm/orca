# Window Session Adoption

"Open in new window" on a project group gives that project its own window. Before this, the new
window ran the same startup chain as every other one, read the same `session:get`, and came up
showing every workspace and tab the window it was opened from was already showing. A project
window now opens **with its own project already open**, and what happens in it is durable.

It did not always. The first cut opened empty, because the workspace session was one global object
with no per-window routing and every write replaced whole keyed maps — a second writer would have
erased the first window's tabs from disk. **Main now partitions that one session along the window
axis**, which is what this document describes.

## The rule

There is still exactly one stored session. What changes is **who owns which keys**, and main —
not the renderer — decides:

| Window          | Reads                                            | Writes                          |
| --------------- | ------------------------------------------------ | ------------------------------- |
| project (scoped)| the keys of its project group, subgroups included | those keys, rebased onto the rest |
| free (shared)   | every key no project window is serving            | those keys, rebased onto the rest |

`partitionWorkspaceSessionByWorktrees` (`shared/workspace-session-window-rebase.ts`) is the single
operation behind all of it: it splits a session into the keys a set of worktrees owns and
everything else. A scoped read is the first half, a free read is the second, and a rebased write
is `rest` of what is stored merged with `owned` of what came in.

**Which keys belong to a project is one rule, and it is not "the repo id inside the key".** A
session key is a worktree id *or* a folder workspace's `folder:<id>`, and a folder workspace
carries its project group itself rather than through a repo. `resolveWorkspaceProjectGroupId`
(`shared/workspace-project-group.ts`) is that rule, shared with the PTY owner index. The first cut
of the partition read the repo id out of the key, so every folder workspace in a project — the
project's own terminal cards — stayed with the free window: the project window opened without them
and the window it was opened from never let them go. Use the shared rule, never a second copy.

**Main resolves the ownership, never the renderer.** A renderer-declared list would let one window
overwrite another's tabs, and the renderer cannot know the answer at hydration time anyway:
project groups load in parallel with the session read, so the window has repos but not yet the
group tree its scope needs. `main/window/window-scoped-session-keys.ts` does the resolving, and
`main/ipc/session.ts` applies it to all three channels.

**A project window picks its own focus.** The stored focus names exactly one workspace, so the
partition hands it to whichever window serves it — and a project window opened while the user was
looking at a different project would read its own tabs with nothing selected. `session:get` fills
that gap for a scoped read only (`main/window/project-window-session-focus.ts`): the most recently
visited workspace it serves that has tabs. It is re-derived on every open rather than remembered,
because a project window never writes the global fields back.

A window's **session adoption** is still decided once at creation and frozen for its lifetime:

`resolveWindowSessionAdoption` (`src/shared/window-session-adoption.ts`) answers `'scoped'` for a
**scoped window opened while another main window is already up**, and `'shared'` for everything
else. Three consequences worth stating outright:

- **The launch's first window always adopts.** With no other window live the answer is `'shared'`
  whatever the scope, so relaunching Orca restores the session exactly as it always did. This is
  the expensive regression, and it is guarded by tests in `shared/window-session-adoption.test.ts`
  and `main/window/createMainWindow-session-adoption.test.ts`.
- **A new free window (File ▸ New Window) is unchanged.** Only scoped windows can open empty.
- **The flag gates the model.** With `experimentalMultiWindow` off at launch,
  `areScopedWindowsEnabled()` is false, so every window resolves to `'shared'` and nothing about
  this feature is reachable.

Rebinding a live window ("Change project", "Free mode") does **not** change its adoption. A window
that already hydrated the session keeps it; emptying it on a rebind would throw away work the user
can see.

## How a renderer learns it

Through argv, like the window id (`shared/window-identity.ts`): `createMainWindow` resolves the
adoption and appends `--orca-window-session=<mode>` to `webPreferences.additionalArguments`, the
sandboxed preload parses it into `window.api.windowIdentity.sessionAdoption`, and
`getRendererWindowSessionAdoption()` reads it.

Argv, not IPC, precisely because this is frozen at creation: it needs no round-trip on the first
paint path, and it survives a `Cmd+R` unchanged. The *scope* is the opposite — main can re-key a
live window, so the renderer asks for it and listens for changes (see
[`per-window-view-state.md`](./per-window-view-state.md)). Do not follow that pattern here.

An older preload appends no flag and a renderer without a main window — the paired web client, the
dashboard pop-out — reports `'shared'`: they are the implicit window, which owns the session.

## The carry/drop policy, and why it stayed

`EMPTY_WINDOW_SESSION_FIELD_POLICY` (`renderer/src/lib/empty-window-workspace-session.ts`)
classifies **every** field of `WorkspaceSessionState` as `carry` or `drop`. Main's partition has
made its projection unnecessary — `adoptWorkspaceSessionRead` no longer reduces anything — but the
table and its exhaustiveness guard stay: they are what forces a new session field to be classified
instead of silently leaking into a window that has no project of its own.

Three fields are carried, because none of them is a thing the user would call open:

- `browserUrlHistory` — address-bar autocomplete.
- `lastVisitedAtByWorktreeId` — Cmd+J empty-query ordering.
- `defaultTerminalTabsAppliedByWorktreeId` — the ledger saying a repo's default tab template
  already ran. Dropping it would re-run the repo's tab commands the first time a workspace opens
  in the new window.

Everything else drops, including `activeConnectionIdsAtShutdown`. That one is deliberate: the
startup SSH restore would connect the target, `syncAfterConnect` would pull that host's remote
workspace snapshot, and the window would fill back up with the workspaces it just declined. The
connection is dialed on demand instead, and it is a process-wide connection in main, so nothing is
lost — see [`ssh-execution-boundary.md`](./ssh-execution-boundary.md).

## Why the write is rebased

Every session write replaces whole keyed maps: `tabsByWorktree`, `unifiedTabs`, `tabGroups` and
the rest are sent entire, not merged per worktree. That is why a second writer used to be
forbidden outright — one debounce would have erased every other window's tabs from disk.

`rebaseWorkspaceSessionWrite` removes the hazard instead of avoiding it: the window's own keys
come from the incoming session, every other key is preserved from what is stored. So
`shouldPersistWorkspaceSession` no longer checks the adoption; it is back to requiring only
`workspaceSessionReady` and `hydrationSucceeded`.

Two rules the rebase keeps, both deliberate:

- **Global fields stay with the free window.** `activeRepoId`, `activeTabId` and friends describe
  one window's focus and there is one slot for them.
- **A key whose worktree cannot be resolved stays with the free window.** Losing it is worse than
  a stale entry, and only that window can be sure nothing else claims it.

Two write paths do not run through the debounced subscriber and were audited:

- **`remoteWorkspace.setForConnectedTargets`** is chained off the local write in
  `use-app-session-persistence.ts`, so no local write means no remote push. The other caller,
  `hooks/remote-workspace-target-sync.ts`, pushes only when the window has local tabs for the
  target, which a window not serving that target does not.
- **`mobile-terminal-close-ipc-bridge.ts`** persists the *whole* session when the CLI or mobile
  closes a terminal tab. Main routes that request to the tab's owner window, and that write goes
  through the same rebase, so it can only touch the keys that window serves.

Both now ride the partition rather than being held back by a gate.

## Separate partitions were considered and dropped

An earlier plan gave each window its own stored partition. Two decisions made that unnecessary and
worse:

- **A project moves, it is not copied.** The window it was opened from releases it, so one key has
  one owner and no terminal is contested — no "Running in another window" overlay, nothing to
  bring across.
- **Closing a project window returns its project to the free window.** Its keys were always in the
  shared session, so they simply stop being served by anyone and the free window reads them again.

With separate partitions, a closed project window's work would sit in a partition nothing reopens
until the user reopens that exact window — and reopening windows at launch does not exist. One
session with owned keys has no such hole.

## The release is live

Opening a project window (or rebinding one) re-partitions the session, and main pushes the result
to every live window on `session:workspacesReleased`
(`main/window/project-window-session-release.ts`): each window is told which of the workspaces it
is showing now belong to someone else. The renderer drops exactly those keys
(`renderer/src/lib/release-workspaces-to-another-window.ts`) through the scoped hydration a remote
snapshot already uses — `rest` of the partition, with the released keys absent. Removal only: PTYs
live in main and survive a renderer letting go of them, and the window that took the project over
reconnects them.

Two deliberate limits:

- **Main names only keys it already has on disk.** A tab opened seconds ago and not yet persisted
  is never yanked out of a window by a race; it settles on the next release or reload. Being late
  is recoverable, removing something nobody asked to remove is not.
- **The other direction is still a reload.** Closing a project window, or putting one back in free
  mode, returns its keys to the free window — but that window learns it on its next hydration.
  Adopting live is the mirror problem and has not been designed.

## What is still missing

Reopening project windows at launch is still absent, and deliberately so: with a project returning
to the free window on close, nothing is lost without it.
