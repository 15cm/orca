# Per-Window View State

With multi-window enabled, some UI state belongs to a window rather than to the profile. Today
that is the project filter (`filterRepoIds` + `filterGroupIds`): one window on each monitor, each
narrowed to a different project group, without the two clobbering each other.

A window can also be **bound to a project group** ("Open in new window" on a group header). That
window shows only that group — its repos, subgroups and folder workspaces — and its filter is
derived from the binding instead of held as mutable state.

## Who owns what

| Layer         | Module                                                                          | Holds                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape         | `src/shared/window-view-state.ts`                                               | `WindowViewState` and `WINDOW_VIEW_STATE_FIELDS`, the one table `pickWindowViewState` / `mergeWindowViewState` / `splitWindowViewUpdates` and the `ui:get` overlay read. Adding a key is one row. `deriveWindowViewState(scope)` is the view-state of a scoped window.                  |
| Scope         | `src/shared/window-scope.ts`                                                    | `WindowScope` (`{ type: 'project-group', projectGroupId }`) and its key `group:<projectGroupId>`, next to `WorkspaceScope`. No new entity: the project group _is_ the durable identity.                                                                                                 |
| Identity      | `src/shared/window-identity.ts`                                                 | The `--orca-window-id=` argv flag and `IMPLICIT_WINDOW_ID`.                                                                                                                                                                                                                             |
| Main registry | `src/main/window/window-view-state-registry.ts`                                 | In-memory `windowId → WindowViewState`, plus `webContents.id → windowId`. A scope key as window id derives its state instead of taking the persisted seed; `rebindWebContentsToWindowId` re-keys a live window. Gated by `setScopedWindowsEnabled` (the launch-time multi-window flag). |
| Main binding  | `src/main/window/window-scope-binding.ts`                                       | Open / bind / release a window against a project group, the one-window-per-project rule, and the `ui:windowScopeChanged` push. `main-window-title.ts` holds the title rule.                                                                                                             |
| Main IPC      | `src/main/ipc/ui-window-scope-handlers.ts`                                      | `ui:getWindowScope`, `ui:openProjectGroupWindow`, `ui:setWindowScope`, `ui:setWindowScopeLabel`.                                                                                                                                                                                        |
| Main routing  | `src/main/ipc/ui-window-view-routing.ts`                                        | `ui:get` overlays the sender's view-state on the profile blob; `ui:set` routes per-window keys to the registry and profile keys to the store; the `ui:stateChanged` broadcast overlays each window's own view-state.                                                                    |
| Renderer      | `src/renderer/src/store/slices/window-scope.ts`, `ui.ts` (`hydratePersistedUI`) | `windowScope` / `scopedWindowsEnabled` as main reports them; the per-window keys hydrate only on `source: 'startup'` or through a scope change. `components/sidebar/window-scope-project-filter.ts` defines the window's filter _baseline_.                                             |

## How a renderer knows its window — and its scope

Main windows are created with `sandbox: true`, so the preload cannot `require` anything, but it
still receives `process.argv`, and Electron appends `webPreferences.additionalArguments` to it.
`createMainWindow` passes the window id as `--orca-window-id=<id>` and the preload exposes it as
`window.api.windowIdentity.windowId`. That value is read once and frozen for the window's
lifetime; it only bootstraps the registry binding and startup diagnostics.

**The scope never comes from argv.** Main can re-key a live window ("Change project", "Free mode",
a deleted group), so the renderer asks `ui.getWindowScope()` alongside `ui.get()` at startup and
applies every later change from the `ui:windowScopeChanged` push. A `Cmd+R` re-asks main and gets
the current binding, not the launch-time one.

Renderers without a main window — the paired web client (`isWebClient()`) and the dashboard
pop-out — report `windowId: null` and a null scope; `getRendererWindowId()` degrades them to
`IMPLICIT_WINDOW_ID` and the web preload stubs the scope channels as unavailable.

## Scoped windows: the derived model

The window id of a scoped window **is** its scope key. Consequences:

- **View-state is a function of identity.** `ensureWindowViewState('group:perc')` returns
  `deriveWindowViewState(scope)` = `{ filterRepoIds: [], filterGroupIds: ['perc'] }`. Nothing is
  persisted for it; the filter is durable because the project group id is.
- **The group filter is pinned.** `updateWindowViewState` accepts widened `filterRepoIds` (see
  containment below) but always rewrites `filterGroupIds` to the scope — no renderer write can
  detach the window from its project.
- **It never writes the persisted seed.** `applyRendererUIUpdate` persists only profile keys for a
  scoped sender, even when it is the focused window. The seed is what mobile and the next free
  window read (`remote-wire-compatibility.md`, Rule 3).
- **One window per project.** Opening or binding to a group that another live window already
  holds reveals that window (`revealExistingMainWindow`) instead of opening a second one.
- **Releasing is re-keying.** "Free mode" and group deletion rebind the window to a fresh UUID
  seeded from the persisted filter (the multi-pick the user had before). A window is never closed
  by losing its group.
- **The flag gates the model, not just the UI.** With `experimentalMultiWindow` off at launch the
  registry treats a scope key as a plain id (persisted seed, no derivation) and main answers
  `unavailable` to every scope request, so nothing can leave a user filtered with the controls to
  undo it hidden. The flag is snapshotted once; changing it needs a restart.

### Sidebar rules in a scoped window

- **The picker is replaced**, not disabled: the Projects row becomes "Project: <name>" with
  _Change project_ (rebind live) and _Free mode_. A multi-pick that looks editable but is
  overwritten by the next hydration is exactly what this avoids.
- **"Clear filters" resets to the baseline**, never to empty. `resetProjectFilterToWindowBaseline`
  serves every route (`use-filters.ts`, both `SidebarFilter.tsx` buttons,
  `SidebarRepositoryFilterSection.tsx`), and `sidebarHasActiveFilters` reads
  `projectFilterActive` — picks beyond the baseline — rather than the effective repo list.
- **Unresolved group ⇒ empty, not everything.** `resolveEffectiveFilterRepoIds` fails open only
  for a free window (startup applies the filter before any catalog exists). A scoped window keeps
  the `EMPTY_PROJECT_GROUP_FILTER_REPO_ID` sentinel and shows "Loading project…" until the catalog
  names the group. "Main cannot resolve this id" is not "invalid id": a remote host's group only
  exists in the renderer catalog, so main opens the window regardless and the title degrades to
  the app name until the renderer reports the name (`ui:setWindowScopeLabel`).
- **Reveal paths widen instead of clearing.** `clearProjectFilterHidingRepo` (CLI `orca`,
  notifications, mobile "open in desktop", SSH agents) adds the repo to `filterRepoIds` in a scoped
  window. This is containment: the reveal still lands in whichever window handles it, and routing
  it to the right project window is a later phase.

### Window title

`composeMainWindowTitle(appName, projectLabel)` → `<project> — <app name>` while bound, the bare
app name otherwise; `page-title-updated` from the renderer's `<title>` is suppressed only while a
label is set. Honest scope: macOS shows it in Mission Control (the one-window-per-display case).
Windows hides the native title bar (`titleBarStyle: 'hidden'`) and Linux drops the frame
(`frame: false`), so there it only surfaces on taskbar hover. The sidebar header label is the
affordance that works on all three.

## Restart behaviour (no single-window regression)

The persisted `filterRepoIds` / `filterGroupIds` in the profile blob remain the **seed** for free
windows: every free window's first `ui:get` copies them into its own view-state, and the next
launch starts from them.

Only the **focused (or last-active) free main window** may rewrite that seed. The debounced UI
writer in every window still sends the filter through `ui:set`, but a background window's write
only updates its own registry entry, and a scoped window's write never reaches the seed at all.
This matters because the writer also fires for non-user changes — catalog pruning after a repo
removal, the post-hydration echo — and those must not overwrite the choice the user made in the
window they are looking at. For a single window this is exactly the pre-feature behaviour.

Scoped windows do not survive a restart in this phase: nothing records which ones were open, so
the next launch opens the usual free window. Reopening the project from the group header restores
the same filter because it is derived, not stored.

## Terminal ownership: which window a PTY delivers to

Every main window publishes its own renderer graph, and a project window and a free window
routinely publish the **same** tabs, leaves and PTYs. The runtime keeps one aggregate graph and
an owner index per entry (`rebuildOwnerWindowIndexes` in `orca-runtime.ts`); `pty:data` is
delivered only to the PTY's owner (`ipc/pty/delivery/owner-window.ts`), and every other window
that renders that pane is a **mirror**. The owner is resolved in three tiers, highest first
(`src/main/runtime/window-pty-ownership-priority.ts`):

1. **An explicit claim** — the user pressed _Bring here_ on a mirrored pane. In memory only; it
   dies with the claiming window (`clearTransientPtyOwnersForWindow`) or with the PTY
   (`clearOwnerWindowForPty`), and no rebind or later rebuild can undo it.
2. **Project scope** — the window bound to project group P owns every tab, leaf and PTY whose
   worktree belongs to P, git worktree (through the repo's `projectGroupId`) or folder workspace
   alike. A worktree that resolves to no group is left alone. Scopes are singletons per group and
   a worktree belongs to one group, so two scoped windows never contest an entry.
3. **Arrival order** — the first window that published it, which is the pre-multi-window rule and
   the only one that runs with the flag off (the runtime then has no scope resolver at all).

A window can only win what it actually publishes in any tier. The runtime learns a window's scope
through an injected resolver (`resolveWindowProjectGroupId`, wired in `main/index.ts` from
`window-view-state-registry`), never by importing `main/window`; a rebind re-resolves through
`setWindowScopeRebindListener` → `handleWindowScopesChanged`.

### What a hand-off does

`onPtyOwnerWindowsChanged` reports every owner change to `ipc/pty/delivery/owner-transfer.ts`:

- **Backpressure credit is per PTY and per renderer.** Bytes in flight to the previous owner can
  never be ACKed by the new one, so `settleRendererDeliveryForOwnerTransfer` repays that credit
  once, drops the pending backlog (the restore below repaints it) and deletes the accounting entry
  so the next send restarts the cumulative baseline. `pty:ackData` only credits ACKs from the
  owning window, so the previous owner's late ACKs cannot re-open the window; on becoming owner
  the renderer resets its own cumulative total (`onPtyBecameOwnedByThisWindow`).
- **The new owner repaints from the model.** A `pty:modelRestoreNeeded` marker with reason
  `owner-change` reuses the existing snapshot/restore path, so the pane shows the current state,
  not the scrollback it froze on.
- **Every window learns its view.** `pty:windowOwnershipChanged` carries, per window,
  `ownedByThisWindow` and the owner's scope; `pty:getWindowOwnership` is the hydration query.
  Nothing is sent while scoped windows are off.

### What a mirror shows

A pane whose PTY is owned elsewhere renders `ForeignWindowPaneOverlay` ("Running in the
<project> window" / "Running in another window") with a single _Bring here_ action
(`pty:claimOwnerWindow`). The overlay is symmetric: after a claim the pane in the window that
lost the PTY shows the same notice pointing at the new owner, with its own button, so the user can
move a terminal back and forth. The scope is purely a client-side delivery choice — an SSH PTY
keeps running on its execution host, and losing contact with that host neither claims nor
releases anything.

Multi-window delivery (the same PTY live in two windows) is deliberately not this: the
accounting assumes one consumer. This picks the one owner well and makes the mirror honest.

## Paired web client and host RPC

The paired client's `ui.set` RPC still writes the host profile blob (it is an implicit window and,
being the client the user is interacting with, it plays the "focused window" role). Desktop
windows are unaffected: the broadcast overlays their own view-state and their renderers ignore
per-window keys on sync. No scope reaches the wire: the RPC params, stream frames and published
snapshot are unchanged.

## Out of scope today, and where it plugs in

- **Reopening scoped windows at launch** (`openWindowScopes`): a startup step that calls
  `openMainWindow({ windowId: projectGroupWindowScopeKey(id) })` for each recorded scope. The
  registry and binding need no change; only the record of open scopes is new.
- **Per-scope window bounds** (`windowBoundsByScope`): `createMainWindow` reads
  `ui.windowBounds` today; a scoped window would look up its own entry by scope key first.
- **Ad-hoc scopes are not durable.** A window bound to nothing but a set of picks is a free
  window; if the picks should persist as an identity, create a project group.
- **Routing reveals to the right window.** Replaces the widening containment above with "find the
  window whose scope admits this repo, or open one".
