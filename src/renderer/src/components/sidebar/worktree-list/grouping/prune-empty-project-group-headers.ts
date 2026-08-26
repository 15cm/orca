import type { Row } from './row-types'

/**
 * Drops project-group headers the active filter emptied.
 *
 * Why only under a filter: a group with no projects is a legitimate resting
 * state — you create one before moving anything into it — so hiding empty
 * groups outright would make a fresh group invisible. Once the user narrows the
 * sidebar, though, a header with nothing under it is pure noise.
 *
 * `count` is the group's subtree total (its projects, its folder workspaces and
 * those of its descendants), already computed against the filtered inputs, so a
 * zero here means the filter left the whole subtree empty.
 */
export function pruneEmptyProjectGroupHeaders(rows: readonly Row[], hasFilter: boolean): Row[] {
  if (!hasFilter) {
    return rows as Row[]
  }
  const pruned = rows.filter(
    (row) => !(row.type === 'header' && row.projectGroup !== undefined && row.count === 0)
  )
  return pruned.length === rows.length ? (rows as Row[]) : pruned
}
