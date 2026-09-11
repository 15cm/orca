# Moving a tab between workspaces

A tab is born in a workspace and, until now, died there. "Move to Workspace" in the
tab context menu rehomes one tab — terminal, editor or browser — into another
workspace without killing, restarting or reattaching anything behind it.

The motivating case: several folder workspaces over the same checkout ("Tasks",
"Terminals", "Closed"). When an agent finishes, its tab moves from Tasks to Closed
to clear the board. The agent keeps running and its scrollback survives.

## What actually moves

`buildTabWorkspaceMove` (`src/renderer/src/store/slices/tab-workspace-move.ts`)
produces one atomic patch:

| State                     | Change                                                            |
| ------------------------- | ----------------------------------------------------------------- |
| `unifiedTabsByWorktree`   | tab leaves the source array, joins the target with a new `groupId` |
| `groupsByWorktree`        | source order/MRU loses the tab, destination group appends it       |
| `layoutByWorktree`        | source split collapses if the group emptied; destination ensured   |
| `activeGroupIdByWorktree` | recomputed for both workspaces                                    |
| content record            | `TerminalTab`, `OpenFile` or `BrowserWorkspace` (see below)        |
| `tabBarOrderByWorktree`   | legacy mixed order follows the tab                                |
| remembered surfaces       | `activeTabId/FileId/BrowserTabId/TabType` re-derived per workspace |

Everything keyed by **tab id** is deliberately left alone — `terminalLayoutsByTabId`
(including `ptyIdsByLeafId`), `ptyIdsByTabId`, `agentStatusByPaneKey`, pane titles,
unread flags. That is what makes the move cheap: the pane's identity never changes,
only the workspace it is filed under.

Content records:

- **terminal** — the `TerminalTab` row moves between `tabsByWorktree` keys.
- **editor** — `OpenFile.worktreeId` is reassigned and `relativePath` recomputed
  against the destination root (absolute path kept when the file is outside it).
- **browser** — the `BrowserWorkspace` record moves keys; its pages are keyed by
  workspace id and stay put.

`diff`, `conflict-review` and `check-details` tabs are **refused**. Their content is
derived from the source workspace's git state, so a moved tab would render another
workspace's changes under the new card. The menu item hides for them.

## The running process keeps its working directory

A live shell cannot be re-rooted: there is no way to change the cwd of a running
process. So when the destination workspace points at a **different folder**, the move:

1. stamps the source folder onto the tab as `startupCwd`, so a later restart
   respawns where the work actually happened rather than silently jumping folders;
2. says so in the success toast ("The running process keeps its working
   directory: …").

When both workspaces share a `folderPath` — the motivating case — nothing is stamped
and nothing is claimed, because nothing moved.

The rule is: never let the destination card imply the process followed it.

## Re-keying the live PTY in main, without a respawn

The renderer is not the only place that files a PTY under a workspace. The runtime
keeps `worktreeId` on its tab, leaf and PTY records, and
`OrcaRuntimeService.resolveTerminalPane(paneKey, expectedWorktreeId)` throws
`terminal_not_found` when the caller's workspace disagrees with them. Leaving that
stale would make the moved tab unaddressable from main (CLI, agents, paired clients)
until the next graph publication — and a tab parked in a workspace the user never
opens may not republish for a long time.

So the renderer tells main explicitly. `pty:rehomeTabWorktree` →
`OrcaRuntimeService.rehomeTerminalTabWorktree(tabId, worktreeId)` →
`rehomeTerminalTabWorktreeRecords` rewrites `worktreeId` on the tab record, every
leaf of that tab, and every PTY bound to it, then replays the shared
`recordPtyWorktree` lifecycle so the advertised-URL watcher rebinds too.

It scans PTYs by `tabId` as well as by leaf, because a tab whose panes are unmounted
has no leaf records but keeps live PTYs registered.

No process is signalled, spawned or reattached. The unmount that follows the move is
the ordinary one: `shouldDetachPaneTransportOnUnmount` detaches rather than destroys
whenever a PTY exists, and the remount reattaches through
`restoredPtyIdByLeafId` — the same path a tab-group move already uses.

## Persistence

Session writes stay renderer-owned (one writer). `buildWorkspaceSessionPayload`
projects the moved store state, so the tab is persisted under the destination
workspace ~150 ms after the move and comes back there on restart. Nothing in the
session is keyed by workspace *and* tab except `tabsByWorktree` / `unifiedTabs` /
`tabGroups`, all of which the projection rebuilds from scratch.

## Destination rules

`resolveTabWorkspaceMoveTargets`
(`src/renderer/src/components/tab-bar/tab-workspace-move-targets.ts`) offers a
workspace only when:

- it is not the tab's current workspace;
- it is not archived;
- it is on the **same execution host** as the tab. A PTY on an SSH host cannot
  follow its tab into a local workspace — see
  [ssh-execution-boundary.md](./ssh-execution-boundary.md). `isExecutionHostAliasForWorktree`
  does the comparison, so a runtime alias of the same host still counts;
- neither workspace's tab model is owned by a remote runtime host (below).

Order matches the rendered sidebar. The rendered order is published by
`WorktreeList` into `rendered-sidebar-worktree-publication.ts`, a leaf module the
menu can read without pulling the sidebar's row pipeline into a context-menu
render. With the workspace list unmounted the menu falls back to catalog order.

## Remote runtime hosts

For a workspace owned by a remote runtime environment the **host** owns the tab
model, and the client mirrors local tab moves to it via `session.tabs.move`
(`mirrorWebRuntimeTabMove`). That RPC's `MoveTab` union has no cross-workspace
member, and adding one would be rejected by every host that predates it — a loud
failure, but still a broken feature against an older host.

Rather than ship a half-wired RPC, the menu **hides** for runtime-owned workspaces:
a local-only move would be overwritten by the host's next snapshot, which is worse
than not offering it.

The extension, when the host side lands, is Rule 2 shaped
([remote-wire-compatibility.md](./remote-wire-compatibility.md)): a new
`session.tabs.moveToWorkspace` method plus a `session-tabs.move-to-workspace.v1`
runtime capability, with `isHostOwnedTabModel` relaxed to "host owns the model and
does not advertise the capability". A new method is not a protocol bump; the
capability is what keeps an old host from being asked.

## Phase 2: dragging a tab onto a sidebar card

Out of scope here, and the two drag systems do not currently meet:

- tab drags are **dnd-kit**: `TabDragItemData` in
  `src/renderer/src/components/tab-group/tab-drag-data.ts`, committed by
  `commitTabDragDrop` in `tab-drag-drop-commit.ts`;
- sidebar workspace cards are **not** dnd-kit droppables. They run their own
  pointer/native drag session for card reordering under
  `src/renderer/src/components/sidebar/worktree-list/drag/`.

The hook points:

1. Make each workspace row a dnd-kit droppable whose data is
   `{ kind: 'workspace-card', worktreeId }`, alongside the existing pointer
   listeners (the two gestures never start together — one begins on a tab, the
   other on a card).
2. In `commitTabDragDrop`, add a branch before the `isTabDragData(overData)` and
   `isPaneDropData(overData)` cases that calls `moveTabToWorkspace`. Note the
   function takes a single `worktreeId` and rejects `activeData.worktreeId !==
worktreeId`; that guard is about the drag's **source** and stays correct — a
   workspace-card drop is the first case where the over-target belongs to a
   different workspace.
3. Gate the drop preview on `resolveTabWorkspaceMoveTargets` so an ineligible card
   (wrong execution host, runtime-owned, the current workspace) never highlights.
