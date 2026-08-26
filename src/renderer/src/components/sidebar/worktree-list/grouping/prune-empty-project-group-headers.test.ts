import { describe, expect, it } from 'vitest'
import { pruneEmptyProjectGroupHeaders } from './prune-empty-project-group-headers'
import type { Row } from './row-types'

function groupHeader(key: string, count: number): Row {
  return {
    type: 'header',
    key,
    label: key,
    count,
    projectGroup: { id: key, name: key, tabOrder: 0 }
  } as unknown as Row
}

const REPO_HEADER = { type: 'header', key: 'repo:pay', label: 'pay', count: 0 } as unknown as Row
const CARD = { type: 'worktree', key: 'w1' } as unknown as Row

describe('pruneEmptyProjectGroupHeaders', () => {
  it('drops emptied project-group headers while a filter is active', () => {
    const rows = [groupHeader('perc', 2), CARD, groupHeader('cce', 0)]
    expect(
      pruneEmptyProjectGroupHeaders(rows, true).map((row) => (row as { key: string }).key)
    ).toEqual(['perc', 'w1'])
  })

  it('keeps empty groups when no filter is active, so a fresh group stays visible', () => {
    const rows = [groupHeader('brand-new', 0)]
    expect(pruneEmptyProjectGroupHeaders(rows, false)).toBe(rows)
  })

  it('leaves non-group headers alone even when they count zero', () => {
    const rows = [REPO_HEADER]
    expect(pruneEmptyProjectGroupHeaders(rows, true)).toBe(rows)
  })

  it('returns the same array when the filter drops nothing', () => {
    const rows = [groupHeader('perc', 1), CARD]
    expect(pruneEmptyProjectGroupHeaders(rows, true)).toBe(rows)
  })
})
