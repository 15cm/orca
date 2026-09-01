# Agent Status Window Replay Notification Plan

## Requirements

- Opening another Orca window must hydrate cached agent statuses without replaying completion notifications.
- Fresh completion events must continue to notify once under existing notification settings.
- Replay behavior must remain correct for local, SSH, relay, and provider-session-only status events.
- Feature-development instructions must retain planning, approval, persisted-contract, and execution gates while removing the separate review-agent cycle.
- The executor owns automated validation and the functional GUI-sandbox scenario.

## Acceptance Criteria

- Main preserves cached-event provenance when forwarding `agentStatus:set` to renderers.
- Renderer applies marked replay events through the existing snapshot replay path.
- Replayed terminal states update status UI without producing alerts.
- Replayed `working` state seeds notification coordination, allowing a later fresh terminal state to notify once.
- Live events retain existing burst batching and notification behavior.
- Full test suite, typecheck, changed-file quality checks, and GUI-sandbox scenario pass.

## Non-goals

- Replacing the agent-hook listener or multi-window broadcast architecture.
- Changing notification content, settings, timing, or native delivery.
- Changing cached status persistence or replay selection.
- Adding new remote opcodes or requiring synchronized client/server upgrades.

## Design

`AgentHookServer.setListener` synchronously emits cached rows with `isReplay: true` whenever main installs its listener for a window. Main currently drops that provenance before broadcasting `agentStatus:set`, so every renderer interprets cached terminal rows as fresh completions.

Add optional `isReplay?: true` to `AgentStatusIpcPayload`. Main includes it in ordinary and provider-session-only broadcasts only for replayed rows. Renderer routes marked `onSet` rows directly into `applyAgentStatusBatch` with `replay: true`, bypassing live burst batching. Existing replay behavior suppresses terminal-state notifications and uses `seedOnly` for replayed `working` state. Pending retries already retain their replay bit.

The optional JSON field is backward compatible across mixed Orca versions. Older renderers ignore it; newer renderers continue treating absent markers as live events.

## Affected Areas

- `AGENTS.md`: gated feature workflow.
- `src/shared/agent-status-ipc-payload.ts`: IPC replay provenance.
- `src/main/index.ts`: replay marker forwarding.
- `src/renderer/src/hooks/ipc-events/`: marked-event routing.
- Renderer agent-status integration tests.

## Risks

- Dropping the marker in one broadcast branch could preserve replayed alerts for that event class.
- Sending replayed rows through the live burst queue could reorder them against fresh events.
- Losing replay provenance during pending-pane retries could create delayed alerts after hydration.
- Misclassifying live rows as replay would suppress valid notifications.

## Validation Plan

Run focused regression coverage first:

```sh
pnpm test src/renderer/src/hooks/useIpcEvents-agent-status-snapshot-replay.test.ts
```

Run repository validation:

```sh
pnpm test
pnpm tc
pnpm run check:code-quality:changed
```

Format changed files when required, then rerun affected checks.

## GUI Scenario

Use a healthy NVIDIA-backed `$gui-sandbox` task and the repository Playwright CDP harness:

1. Enable completion notifications and produce one fresh completion alert.
2. Record notification count and visible agent state.
3. Open a second Orca window.
4. Confirm cached statuses hydrate in the second window while notification count stays unchanged.
5. Produce another fresh working-to-complete transition.
6. Confirm one new completion notification is delivered.
7. Collect sandbox artifacts and destroy only the created task through `gui-sandbox`.

## Ordered Execution

1. Persist this approved contract and update `AGENTS.md`.
2. Add optional replay provenance to shared IPC payload.
3. Forward replay provenance from main in every status broadcast branch.
4. Route marked renderer events through replay application.
5. Add focused regression tests for replay suppression and fresh completion delivery.
6. Run focused and complete automated validation.
7. Run GUI-sandbox scenario, collect artifacts, and safely clean up.
