import type { ResolvedWorktree } from './runtime-worktree-path-identity'
import { worktreeIdComparisonKey } from '../../shared/worktree/id'
import { branchSelectorMatches, runtimePathsEqual } from './runtime-worktree-path-identity'

type SelectorOptions = { getHostId?: (worktree: ResolvedWorktree) => string }

export function matchWorktreeSelectorCandidates(
  selector: string,
  worktrees: readonly ResolvedWorktree[],
  options: SelectorOptions = {}
): ResolvedWorktree[] {
  if (selector === 'active') {
    return []
  }
  if (selector.startsWith('identity:')) {
    return worktrees.filter((w) => w.identity?.key === selector.slice(9))
  }
  if (selector.startsWith('id:')) {
    const id = selector.slice(3)
    const exact = worktrees.filter((w) => w.id === id)
    if (exact.length) {
      return exact
    }
    const key = worktreeIdComparisonKey(id)
    return key ? worktrees.filter((w) => worktreeIdComparisonKey(w.id) === key) : []
  }
  if (selector.startsWith('path:')) {
    const candidates = worktrees.filter((w) => runtimePathsEqual(w.path, selector.slice(5)))
    if (candidates.length < 2) {
      return candidates
    }
    const hostIds = new Set(
      candidates.map(
        (worktree) =>
          options.getHostId?.(worktree) ?? worktree.ownerHostId ?? worktree.hostId ?? 'local'
      )
    )
    return hostIds.size === 1 ? [candidates[0]] : candidates
  }
  if (selector.startsWith('branch:')) {
    return worktrees.filter((w) => branchSelectorMatches(w.branch, selector.slice(7)))
  }
  if (selector.startsWith('name:')) {
    return worktrees.filter((w) => w.displayName === selector.slice(5))
  }
  if (selector.startsWith('issue:')) {
    return worktrees.filter(
      (w) => w.linkedIssue !== null && String(w.linkedIssue) === selector.slice(6)
    )
  }
  return worktrees.filter(
    (w) =>
      w.id === selector ||
      runtimePathsEqual(w.path, selector) ||
      branchSelectorMatches(w.branch, selector)
  )
}
