# Per-Window View State

With multi-window enabled, some UI state belongs to a window rather than to the profile. Today that
is the project filter (`filterRepoIds` + `filterGroupIds`): one window on each monitor, each
narrowed to a different project group, without the two clobbering each other.

## Who owns what

| Layer | Module | Holds |
| --- | --- | --- |
| Shape | `src/shared/window-view-state.ts` | `WindowViewState` and `WINDOW_VIEW_STATE_KEYS`; `splitWindowViewUpdates` separates a `ui:set` payload into the window-owned subset and the profile-owned rest. Adding a key here is what makes it per-window everywhere. |
| Identity | `src/shared/window-identity.ts` | The `--orca-window-id=` argv flag and `IMPLICIT_WINDOW_ID`. |
| Main registry | `src/main/window/window-view-state-registry.ts` | In-memory `windowId → WindowViewState`, plus `webContents.id → windowId` so IPC senders resolve to a window. State lives as long as the window (renderer reloads keep it; close drops it). |
| Main routing | `src/main/ipc/ui-window-view-routing.ts` | `ui:get` overlays the sender's view-state on the profile blob (seeding it from the persisted value on first read); `ui:set` routes per-window keys to the registry and profile keys to the store; the `ui:stateChanged` broadcast overlays each window's own view-state. |
| Renderer | `src/renderer/src/store/slices/ui.ts` (`hydratePersistedUI`) | Applies the per-window keys only on `source: 'startup'`. A `'sync'` broadcast never touches them — the same rule `activeView` already follows — so a broadcast racing the 150 ms UI writer cannot roll back a fresh change. |

## How a renderer knows its window

Main windows are created with `sandbox: true`, so the preload cannot `require` anything, but it
still receives `process.argv`, and Electron appends `webPreferences.additionalArguments` to it.
`createMainWindow` mints a per-launch `windowId` (`randomUUID`), passes it as
`--orca-window-id=<id>`, and the preload exposes it as `window.api.windowIdentity.windowId`.

Why this over a `sendSync` at preload time: it is synchronous, needs no IPC handler to be
registered yet (the main window defers load until handlers exist, but a reload does not), and it
cannot stall first paint. Why not `BrowserWindow.id`: Electron ids restart from 1 every launch, so
they can never anchor durable state; the string id is the slot a stable profile id fills later.

Renderers without a main window — the paired web client (`isWebClient()`) and the dashboard
pop-out — report `windowId: null`, and `getRendererWindowId()` degrades them to
`IMPLICIT_WINDOW_ID`: one implicit window, same code paths, no special-casing downstream.

## Restart behaviour (no single-window regression)

The persisted `filterRepoIds` / `filterGroupIds` in the profile blob remain the **seed**: every
window's first `ui:get` copies them into its own view-state, and the next launch starts from them.

Only the **focused (or last-active) main window** may rewrite that seed. The debounced UI writer in
every window still sends the filter through `ui:set`, but a background window's write only updates
its own registry entry. This matters because the writer also fires for non-user changes — catalog
pruning after a repo removal, the post-hydration echo — and those must not overwrite the choice the
user made in the window they are looking at. For a single window this is exactly the pre-feature
behaviour: it is always the focused window, so its filter is persisted and restored.

## Paired web client and host RPC

The paired client's `ui.set` RPC still writes the host profile blob (it is an implicit window and,
being the client the user is interacting with, it plays the "focused window" role). Desktop windows
are unaffected: the broadcast overlays their own view-state and their renderers ignore per-window
keys on sync. Routing the RPC through the registry keyed by `RpcContext.clientId` would make the
web client a real window entry; that is the natural next step once profiles exist.

## Out of scope today, and where it plugs in

- **Persisting per-window state**: the registry is the only owner; nothing survives the window.
  A durable owner would replace `ensureWindowViewState`'s seed callback with a profile read and
  `updateWindowViewState` with a profile write — the routing module does not change.
- **Window profiles**: a named profile owns a `WindowViewState` (later also layout). A window
  *adopts* a profile, which becomes the key the registry resolves `webContents.id` to instead of the
  per-launch UUID. Because the registry is already keyed by string and the renderer already carries
  its id, adoption is a mapping change in main plus a picker in the renderer, not a re-plumb of
  `ui:get` / `ui:set`.
