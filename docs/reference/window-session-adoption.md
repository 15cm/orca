# Window Session Adoption

"Open in new window" on a project group gives that project its own window. Before this, the new
window ran the same startup chain as every other one, read the same `session:get`, and came up
showing every workspace and tab the window it was opened from was already showing. A project
window now opens **empty**: its sidebar shows its project, and nothing is open inside it.

That is a feature, but it is also the first cut of a much larger seam. **The workspace session is
one global object with no per-window routing.** `session:get` / `session:set` / `session:patch`
(`src/main/ipc/session.ts`) take an optional `hostId` and nothing else; every renderer runs the
same `session-get` in `use-app-startup-hydration.ts` and the same write subscriber in
`use-app-session-persistence.ts`. This document is where the window dimension gets added.

## The rule

A window's **session adoption** is decided once, when the window is created, and frozen for its
lifetime (reloads included):

| Adoption   | Reads                                            | Writes |
| ---------- | ------------------------------------------------ | ------ |
| `'shared'` | the profile-wide session, exactly as before       | yes    |
| `'empty'`  | nothing but the history and ledgers listed below  | never  |

`resolveWindowSessionAdoption` (`src/shared/window-session-adoption.ts`) answers `'empty'` for a
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

## What an empty window still reads

`emptyWindowWorkspaceSession` (`renderer/src/lib/empty-window-workspace-session.ts`) projects the
read session down. `EMPTY_WINDOW_SESSION_FIELD_POLICY` classifies **every** field of
`WorkspaceSessionState` as `carry` or `drop`, with the same exhaustiveness guard
`workspace-session-host-field-ownership.ts` uses, so a new session field cannot leak into an empty
window by defaulting to "kept".

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

## Why it must never write

Every session write replaces whole keyed maps: `tabsByWorktree`, `unifiedTabs`, `tabGroups` and
the rest are sent entire, not merged per worktree. A window holding an empty session that wrote
once would erase every other window's tabs from disk, and the next launch's with them.

So `shouldPersistWorkspaceSession` — the single predicate the debounced writer, the shutdown
checkpoint and the periodic sleeping-agent capture all consult — requires `'shared'` on top of
`workspaceSessionReady` and `hydrationSucceeded`.

Two write paths do not run through the debounced subscriber and were audited:

- **`remoteWorkspace.setForConnectedTargets`** is chained off the local write in
  `use-app-session-persistence.ts`, so no local write means no remote push. The other caller,
  `hooks/remote-workspace-target-sync.ts`, pushes only when the window has local tabs for the
  target, which an empty window does not.
- **`mobile-terminal-close-ipc-bridge.ts`** persists the *whole* session when the CLI or mobile
  closes a terminal tab. Main routes that request to the tab's owner window, and a window that
  opened empty owns a tab as soon as the user makes one there — so the call is gated on
  `shouldPersistWorkspaceSession` too.

The consequence is honest and worth stating: **what the user does in an empty window is not
durable.** It survives for the window's life; a reload or a close loses it. Scoped windows do not
survive a relaunch in this phase either, so nothing is lost that phase 2 was not already going to
have to build.

## What this buys the PTY ownership problem

A window can only own a PTY it actually publishes
([`per-window-view-state.md`](./per-window-view-state.md), "Terminal ownership"). An empty window
publishes nothing, so it contests nothing: the window that had the terminals keeps them, and the
"Running in another window" mirror overlay stops appearing merely because a second window was
opened. Two windows now diverge only where the user made them diverge.

## Where the per-window partition plugs in

The end state is one session partition per window, which makes an empty window durable and lets
the open windows come back at launch (phase 2). Everything needed to get there attaches to the
type in `shared/window-session-adoption.ts`:

1. **Give `WindowSessionAdoption` a third arm** carrying a partition key — the scope key
   (`group:<projectGroupId>`) for a scoped window, since that is already durable.
   `resolveWindowSessionAdoption` returns it instead of `'empty'`, and the argv flag carries it.
2. **Add the window dimension to the session channels.** `session:get` / `set` / `patch` in
   `src/main/ipc/session.ts` take a partition key beside `hostId`; `Store.getWorkspaceSession`
   grows the same second dimension. Old renderers that send neither keep reading the shared
   partition, which is what makes this safe to ship incrementally.
3. **Route the reads and writes.** `fetchWorkspaceSessionWithRuntimeHostOwners` and
   `patchWorkspaceSessionByHost` take the key from the store; `adoptWorkspaceSessionRead` stops
   projecting and becomes the partitioned read. `shouldPersistWorkspaceSession` drops the
   `'shared'` check — with a partition of its own, every window may write.
4. **Record which scopes were open** so `openWindowScopes` can reopen them at launch. Only then
   does the "first window always adopts" rule need revisiting: the window that reopens the shared
   partition should be the free one, not merely the first.

Steps 1 and 3 touch the two renderer call sites this feature already isolated — startup adoption
and the write gate. Step 2 is the real work, and nothing above it needs to change to do it.
