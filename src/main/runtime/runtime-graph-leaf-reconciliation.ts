// @ts-nocheck -- runtime graph reconciliation operates on the service's private indexes.
import type { RuntimeLeafRecord } from './runtime-terminal-state-records'

export function reconcileRuntimeGraphLeaves(
  runtime: object,
  lifecycleLeaves: readonly unknown[],
  graphSyncedAt: number,
  preserveLivePtysDuringReload: boolean
): Map<string, RuntimeLeafRecord> {
  const nextLeaves = new Map<string, RuntimeLeafRecord>()
  for (const leaf of lifecycleLeaves) {
    if (leaf.ptyId) {
      if (leaf.parked) {
        runtime.orchestrationMailboxPointerDelivery.markPtyColdParked(leaf.ptyId)
      } else {
        runtime.orchestrationMailboxPointerDelivery.clearPtyColdParked(leaf.ptyId)
      }
    }
    const leafKey = runtime.getLeafKey(leaf.tabId, leaf.leafId)
    const existing = runtime.leaves.get(leafKey)
    const ptyId =
      preserveLivePtysDuringReload && leaf.ptyId === null && existing?.ptyId
        ? existing.ptyId
        : leaf.ptyId
    const ptyGeneration =
      existing && existing.ptyId !== ptyId
        ? existing.ptyGeneration + 1
        : (existing?.ptyGeneration ?? 0)
    const existingPty = ptyId ? runtime.ptysById.get(ptyId) : undefined
    const tailSource = existing?.ptyId === ptyId ? existing : existingPty

    nextLeaves.set(leafKey, {
      ...leaf,
      ptyId,
      ptyGeneration,
      connected: ptyId !== null,
      writable: runtime.graphStatus === 'ready' && ptyId !== null,
      lastOutputAt: tailSource?.lastOutputAt ?? null,
      lastExitCode: tailSource?.lastExitCode ?? null,
      lastExitCause: tailSource?.lastExitCause ?? null,
      tailBuffer: tailSource?.tailBuffer ?? [],
      tailTranscriptBuffer: tailSource?.tailTranscriptBuffer ?? [],
      tailTranscriptChars: tailSource?.tailTranscriptChars ?? 0,
      tailPartialLine: tailSource?.tailPartialLine ?? '',
      tailPendingAnsi: tailSource?.tailPendingAnsi ?? '',
      tailRedrawCursor: tailSource?.tailRedrawCursor ?? null,
      tailTruncated: tailSource?.tailTruncated ?? false,
      tailLinesTotal: tailSource?.tailLinesTotal ?? 0,
      preview: tailSource?.preview ?? '',
      waitBlockedAt: tailSource?.waitBlockedAt ?? null,
      lastAgentStatus: tailSource?.lastAgentStatus ?? null,
      lastAgentStatusObservedLive: tailSource?.lastAgentStatusObservedLive ?? false,
      lastOscTitle: tailSource?.lastOscTitle ?? null,
      lastOscTitleAt: tailSource?.lastOscTitleAt ?? null,
      paneTitleUpdatedAt:
        existing?.ptyId === ptyId && existing.paneTitle === leaf.paneTitle
          ? existing.paneTitleUpdatedAt
          : graphSyncedAt
    })

    if (leaf.ptyId) {
      runtime.recordPtyWorktree(leaf.ptyId, leaf.worktreeId, {
        connected: true,
        lastOutputAt: existing?.ptyId === leaf.ptyId ? existing.lastOutputAt : null,
        preview: existing?.ptyId === leaf.ptyId ? existing.preview : '',
        tabId: leaf.tabId,
        paneKey: runtime.makeRuntimePaneKey(leaf)
      })
    }

    if (existing && (existing.ptyId !== ptyId || existing.ptyGeneration !== ptyGeneration)) {
      const adoptedFirstPty =
        existing.ptyId === null && runtime.adoptFirstPtyForLeafHandle(leafKey, ptyId, ptyGeneration)
      if (!adoptedFirstPty) {
        runtime.invalidateLeafHandle(leafKey)
      }
    }
  }

  const nextPtyIds = new Set(
    [...nextLeaves.values()].map((leaf) => leaf.ptyId).filter((ptyId): ptyId is string => !!ptyId)
  )
  for (const oldLeafKey of runtime.leaves.keys()) {
    if (nextLeaves.has(oldLeafKey)) {
      continue
    }
    const oldLeaf = runtime.leaves.get(oldLeafKey)
    if (oldLeaf?.ptyId && !nextPtyIds.has(oldLeaf.ptyId)) {
      runtime.orchestrationMailboxPointerDelivery.markPtyColdParked(oldLeaf.ptyId)
    }
    const retainedIncarnation = oldLeaf?.ptyId
      ? runtime.handleByPtyIncarnation.get(oldLeaf.ptyId)
      : undefined
    if (
      preserveLivePtysDuringReload &&
      oldLeaf?.ptyId &&
      (runtime.handleByPtyId.has(oldLeaf.ptyId) ||
        (retainedIncarnation &&
          retainedIncarnation.incarnationId ===
            runtime.ptysById.get(oldLeaf.ptyId)?.incarnationId)) &&
      !nextPtyIds.has(oldLeaf.ptyId)
    ) {
      nextLeaves.set(oldLeafKey, oldLeaf)
      nextPtyIds.add(oldLeaf.ptyId)
    } else if (oldLeaf?.ptyId && nextPtyIds.has(oldLeaf.ptyId)) {
      const oldHandle = runtime.handleByLeafKey.get(oldLeafKey)
      const incarnationHandle = retainedIncarnation?.handle
      if (
        oldHandle !== undefined &&
        (oldHandle === runtime.handleByPtyId.get(oldLeaf.ptyId) || oldHandle === incarnationHandle)
      ) {
        runtime.handleByLeafKey.delete(oldLeafKey)
      } else {
        runtime.invalidateLeafHandle(oldLeafKey)
      }
    } else {
      runtime.invalidateLeafHandle(oldLeafKey)
    }
  }

  for (const [ptyId, leaf] of runtime.detachedPreAllocatedLeaves) {
    if (nextPtyIds.has(ptyId) || !runtime.handleByPtyId.has(ptyId)) {
      runtime.detachedPreAllocatedLeaves.delete(ptyId)
      continue
    }
    nextLeaves.set(runtime.getLeafKey(leaf.tabId, leaf.leafId), leaf)
    nextPtyIds.add(ptyId)
  }
  return nextLeaves
}
