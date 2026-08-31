# Multi-window tab sync and terminal ownership

## Requirements

Every trusted Orca main window in the same app process must see tab creation, rename, close, common metadata, backing-state, and terminal-binding changes from every other main window.

Tabs created elsewhere appear in the background. Each receiving window keeps its own selected tab, active group, recent-tab history, split layout, preview state, and focus history.

When duplicate terminal tabs exist across windows, the focused window owns their PTYs. Refocusing another window transfers input and output ownership, restores the terminal from the authoritative model, and preserves the first typed key.

### Acceptance criteria

- Terminal, editor-family, browser, and simulator tab lifecycle changes propagate to every live main window.
- Receiving windows add new tabs without changing local selection or layout focus.
- Late-opening windows hydrate the latest shared catalog before publishing local mutations.
- Concurrent mutations on different tabs merge; duplicate mutations are idempotent.
- Close tombstones prevent delayed rename, binding, or session writes from resurrecting tabs.
- Focused eligible window can type into an existing duplicated terminal tab.
- Native refocus returns PTY control and current output to that window.
- First valid write can claim ownership atomically and is forwarded without loss.
- Old, untrusted, unfocused, and graph-ineligible renderers cannot write after transfer.
- Owner close falls back to a surviving eligible window.
- Local Git worktrees, folder workspaces, and SSH workspaces use execution-host-aware workspace identity.

### Non-goals

- Synchronize tab selection, group focus, split layout, preview state, or focus history.
- Change visual design or styling.
- Add or change remote RPC methods, stream opcodes, or remote wire payloads.
- Duplicate terminal processes per window.

## Design

### Main-owned tab catalog

Add a process-global coordinator partitioned by execution host and workspace key. It exposes local Electron IPC for bootstrap, typed mutation submission, acknowledgement, and canonical change events.

Coordinator stores common tab metadata plus existing serialized type-specific backing state needed to render terminal, editor-family, browser, and simulator tabs. Main assigns monotonic revisions and deduplicates mutation IDs.

Mutations are explicit create, patch-existing, close, and terminal-binding updates. Operations apply by tab ID against current canonical state:

- Create is idempotent and rejects conflicting reuse of an existing or tombstoned ID.
- Patch and binding updates affect existing tabs only.
- Close records a tombstone and cleans backing state only when no remaining tab references it.
- Operations on different tab IDs merge in coordinator order.

Persist coordinator-owned catalog state through existing workspace-session storage. Generic renderer session patches and synchronous shutdown checkpoints must not overwrite canonical membership or resurrect stale records. Remote wire shapes remain unchanged.

### Renderer reconciliation

Derive catalog mutations centrally from tab-store transitions so every creation, metadata, binding, and closure path is covered. Disable publication until initial bootstrap completes and suppress outbound generation while applying coordinator events.

On remote create, append tab to receiver's current group for that workspace, or ensure a root group when none exists. Keep it inactive. Apply metadata, backing-state, terminal-layout, and close changes to matching local entry without replacing receiver-local placement or focus fields.

### Focused-window PTY ownership

Trusted top-level terminal-tab focus claims PTYs present in that window's ready runtime graph. Native window focus republishes active tab so a returning window reclaims control. A valid PTY write performs same claim atomically before forwarding as fallback.

Runtime retains a preferred owner only while its ready graph contains PTY. Ownership changes notify PTY IPC layer. Transfer clears old renderer credit and pending-byte state, releases stale producer pauses, resets delivery hints, and sends `pty:modelRestoreNeeded` with local reason `owner-transfer` to new owner. Existing model snapshots provide repaint state.

## Affected areas

- Workspace-session IPC, preload types, and persistence ownership.
- Renderer tab-store synchronization and startup hydration.
- Runtime per-window graph ownership and PTY delivery accounting.
- Multi-window unit, integration, and Electron E2E coverage.

## Risks

- Stale full-session writers can resurrect closed tabs unless catalog-owned fields are protected at every set, patch, and synchronous checkpoint path.
- Applying remote changes through ordinary actions can rebroadcast loops; remote reconciliation needs explicit suppression boundary.
- Terminal ownership transfer can retain delivery credit or producer pauses from previous renderer; reconcile all process-global PTY accounting atomically.
- Duplicate tab IDs across workspaces require execution host, workspace key, and tab ID identity.
- Window close or graph replacement can invalidate owner between claim and delivery; revalidate and select surviving candidate.

## Validation plan

### Unit and integration cases

- Simultaneous mutations on different tabs merge without loss.
- Duplicate mutation IDs deduplicate; conflicting same-ID creates return canonical state.
- Stale patches and shutdown writes cannot resurrect a closed tab.
- Host and workspace partitions remain isolated.
- Late windows receive current revision and do not echo bootstrap state.
- Remote creates stay backgrounded and preserve local group, selection, recency, preview, and split layout.
- Terminal, editor-family, browser, and simulator create, rename, metadata, backing-state, and close changes reconcile.
- Trusted focus, native refocus, first-write fallback, first-byte preservation, snapshot repaint, accounting cleanup, untrusted rejection, and owner-close fallback work.
- Folder and SSH workspace identities select correct catalog and PTY graph.

### Electron UI scenario

Use an isolated E2E profile with experimental multi-window enabled. Open two real main windows. Create, rename, and close shared tabs from alternating windows; verify each remote create remains backgrounded. Alternate focus between duplicated terminal tabs and type from each window, asserting first-key delivery and visible output after each transfer. Open a third window and verify late hydration.

Run headfully with repository Playwright Electron/CDP inside `$gui-sandbox`. Inspect accessibility state and screenshots for every main window, collect artifacts, then destroy sandbox. Never run Orca GUI tests on host. Repository-requested `$electron` skill is unavailable, so use existing Playwright Electron fixture.

### Commands

```bash
pnpm exec vitest run --config config/vitest.config.ts <targeted-tests>
pnpm run typecheck
pnpm run lint
pnpm test
pnpm exec electron-vite build --mode e2e
SKIP_BUILD=1 pnpm exec playwright test tests/e2e/multi-window-tab-sync-and-pty-ownership.spec.ts --config tests/playwright.config.ts --project=electron-headless --workers=1
git diff --check
```

Complete `pnpm test` and isolated GUI validation are mandatory.

## Ordered execution plan

1. Add shared catalog types, coordinator, local IPC, preload surface, and persistence protection.
2. Add renderer mutation derivation, bootstrap, reconciliation, and echo suppression.
3. Add trusted focus and first-write PTY ownership claims.
4. Reconcile PTY delivery state and authoritative-model restore on transfer.
5. Add targeted unit and integration coverage.
6. Add multi-window Electron E2E coverage.
7. Run targeted checks, typecheck, lint, complete test suite, E2E build/spec, GUI-sandbox validation, and `git diff --check`.
8. Report changed files, commands, results, artifacts, and deviations. Any design or scope change returns for approval before implementation continues.

## Delivery workflow

`cx-luna-medium` owns implementation against this document. A fresh `cx-sol-high` pass reviews this contract, Luna's report, and complete Git diff. After every Sol pass, pause for explicit human review of each finding. The human records one classification per finding — confirmed blocker, non-blocking issue, or clarification required — plus rationale. Sol severity alone cannot authorize Luna fixes or advancement. Luna fixes only human-confirmed blockers and reruns affected validation; Sol re-reviews the complete updated diff. Even a clean Sol pass requires explicit human approval before advancement or closure. Repeat until the human approves closure and mandatory validation passes.

### Review decision log

Record each Sol iteration's findings and the human classification/rationale here before dispatching further work. Use `none` with rationale when Sol reports no findings.

#### A2.2 re-review — 2026-08-31

- Browser `catalogEntityId` rejection: **non-blocking for this iteration**. Healthy sandbox browser hydration passed; malformed raw-browser catalog input was not exercised. Retain as a coverage gap for a later targeted test.
- Missing editor backing materialization: **non-blocking for this iteration**. Healthy sandbox editor hydration passed; no missing-backing scenario reproduced. Retain as a coverage gap.
- Terminal backing/precondition and transfer output: **confirmed blocker**. Seven hook tests fail, and headful sandbox typing forwarded input but failed visible transfer output, directly affecting the requested cross-window terminal behavior.
