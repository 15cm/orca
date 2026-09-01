# Agent Status Window Replay Notification Follow-up Plan

## Requirements

- Opening or recreating an Orca window must not emit desktop, mobile, sound, or in-app fallback notifications from cached agent or terminal state.
- Suppression must cover delayed completion paths that settle after window hydration, including terminal-title and process/completion coordinator replay.
- A fresh working-to-terminal transition after the new window is ready must still produce exactly one logical completion notification.
- Behavior must remain correct for local, SSH, relay, paired runtime, git-worktree, and folder workspaces.

## Acceptance Criteria

- Replayed terminal agent states seed completion deduplication without dispatching notifications or terminal lifecycle side effects.
- Replayed terminal states cannot later produce an alert through title, process-inspection, OSC, retry, or quiet-window timers unless fresh work is observed first.
- Fresh working evidence re-arms completion notification tracking.
- One later fresh completion creates exactly one desktop dispatch and one mobile fanout under enabled settings.
- Existing notification settings, focus suppression, unread state, notification content, and click routing remain unchanged.
- Focused tests, complete test suite, typecheck, changed-file quality checks, and GUI-sandbox scenario pass.

## Non-goals

- Replacing the agent-hook listener, multi-window broadcast architecture, or completion coordinator.
- Moving notification ownership wholesale from renderer to main.
- Changing notification text, sound selection, cooldown duration, settings, or native delivery.
- Changing agent-status persistence or remote wire opcodes.

## Diagnosis

The previous fix preserved `isReplay` across hook-server listener IPC and correctly routes marked rows through renderer snapshot application. It only seeds notification coordination for replayed `working` rows. Replayed terminal rows therefore update visible state but do not establish terminal completion identity in a new renderer.

A new window creates fresh completion coordinators. Terminal/title hydration can replay already-completed state into those coordinators and dispatch after the completion quiet window. The existing multi-window E2E assertion checks the count immediately after sidebar hydration, before delayed completion paths settle. Its final fresh-completion assertion checks only that a matching alert exists, not that exactly one new alert was delivered.

## Design

Extend the existing completion-coordinator replay seed path rather than add parallel notification state. Replayed `working`, attention, and terminal rows must be accepted as state seeds. Terminal seeds record the stable completion identity and require fresh working evidence, but never schedule quiet-window timers, dispatch completion or attention, run terminal lifecycle effects, or mark unread state.

Route every renderer replay source through that seed contract, including marked `agentStatus:set`, `agentStatus:getSnapshot`, pending-pane retries, paired session snapshots, and renderer-owned terminal/OSC hydration where replay provenance is available. Preserve live transition behavior when replay provenance is absent.

Keep completion identity scoped by stable pane id and existing status lane rules. A later fresh `working` transition clears the replay fence and permits one fresh terminal transition. Do not use window focus or elapsed-time heuristics as replay evidence.

Strengthen regression coverage so delayed timers are drained after window launch and notification counts are exact. Cover a cached terminal row followed by title/process replay, then a fresh working-to-done transition.

## Affected Areas

- `src/renderer/src/components/terminal-pane/agent-completion-*`: replay seed semantics and shared completion identity.
- `src/renderer/src/hooks/agent-hook-completion-notifications.ts`: replayed terminal-state seeding.
- `src/renderer/src/hooks/ipc-events/`: replay routing and pending retries.
- `src/renderer/src/runtime/web-session-tabs-sync.ts`: paired snapshot replay seeding if current paths do not already satisfy the contract.
- Focused coordinator, renderer IPC, paired-runtime, and multi-window E2E tests.

## Risks

- Treating a live terminal event as replay could suppress a valid alert.
- Seeding terminal identity without fresh-working re-arm could suppress the next real completion.
- A title or process timer queued before replay seeding could still fire unless dispatch-time identity checks observe the seed.
- Cross-lane identity changes could regress hook/title deduplication or leak pane-scoped state.
- Remote client and host versions may differ; any shared payload change must remain optional and backward compatible.

## Validation Plan

Run focused tests for changed coordinator, IPC replay, paired-runtime, and notification paths:

```sh
pnpm test src/renderer/src/components/terminal-pane/agent-completion-coordinator-completion-replay-guard.test.ts
pnpm test src/renderer/src/hooks/useIpcEvents-agent-status-listener-replay.test.ts
pnpm test src/renderer/src/hooks/useIpcEvents-agent-status-snapshot-replay.test.ts
pnpm test src/renderer/src/runtime/web-session-tabs-agent-completion-notifications.test.ts
```

Run repository validation:

```sh
pnpm test
pnpm tc
pnpm run check:code-quality:changed
```

Run `pnpm format` when required, then rerun affected checks.

## GUI Scenario

Use a healthy NVIDIA-backed `$gui-sandbox` task. Follow repository Electron validation rules and the sandbox's version-matched workflow.

1. Enable agent completion notifications.
2. Produce a completed agent turn and wait beyond all completion quiet-window timers.
3. Record desktop dispatch, mobile fanout, sound, and fallback-toast counts.
4. Open a second Orca window and hydrate the completed pane, including its terminal surface.
5. Wait beyond quiet-window and process-inspection delays; verify every count remains unchanged.
6. Produce one fresh working-to-done transition.
7. Wait for completion delivery and verify exactly one new logical notification, one desktop delivery, and one mobile fanout.
8. Repeat relevant ownership coverage for a folder workspace or paired/SSH fixture when available in the isolated harness.
9. Collect artifacts, then destroy only the created sandbox task.

## Ordered Execution

1. Reproduce the delayed window-launch notification with a focused test that drains timers.
2. Extend existing completion replay seeding to terminal states without side effects.
3. Route all cached renderer status sources through the seed contract.
4. Add fresh-working re-arm and cross-lane deduplication coverage.
5. Strengthen multi-window E2E assertions to wait through delayed paths and require exact counts.
6. Run focused validation and fix regressions within approved scope.
7. Run the complete test suite, typecheck, changed-file quality checks, and formatting.
8. Run the GUI-sandbox scenario, collect evidence, and safely clean up.
9. Report changed files, commands, results, and deviations. Return any scope or design change for human approval before continuing.
