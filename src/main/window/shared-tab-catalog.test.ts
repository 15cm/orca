import { describe, expect, it } from 'vitest'
import { SharedTabCatalog, type SharedTabMutation } from './shared-tab-catalog'

const key = { executionHostId: 'local' as const, workspaceKey: 'repo::worktree' }
const create = (mutationId: string, tabId = 'tab-1'): SharedTabMutation => ({
  mutationId,
  kind: 'create',
  key,
  tab: {
    tabId,
    contentType: 'terminal',
    metadata: { entityId: tabId, label: 'Terminal', customLabel: null, color: null },
    backingState: { kind: 'terminal', ptyIds: [] }
  }
})

describe('SharedTabCatalog', () => {
  it('merges independent tabs and deduplicates mutation IDs', () => {
    const catalog = new SharedTabCatalog()
    expect(catalog.submit(create('a')).revision).toBe(1)
    expect(catalog.submit(create('b', 'tab-2')).revision).toBe(2)
    expect(catalog.submit(create('a')).revision).toBe(1)
    expect(catalog.bootstrap(key).tabs.map((tab) => tab.tabId)).toEqual(['tab-1', 'tab-2'])
  })

  it('rejects conflicting create reuse and preserves close tombstones', () => {
    const catalog = new SharedTabCatalog()
    catalog.submit(create('a'))
    const conflictingCreate = create('b')
    if (conflictingCreate.kind !== 'create') {
      throw new Error('test fixture')
    }
    const conflict = catalog.submit({
      ...conflictingCreate,
      tab: {
        ...conflictingCreate.tab,
        metadata: { entityId: 'tab-1', label: 'other', customLabel: null, color: null }
      }
    })
    expect(conflict.tab?.metadata.label).toBe('Terminal')
    catalog.submit({ mutationId: 'close', kind: 'close', key, tabId: 'tab-1' })
    expect(catalog.submit(create('late')).tab).toBeNull()
    expect(catalog.bootstrap(key).tombstones).toEqual(['tab-1'])
  })

  it('keeps execution-host and workspace partitions isolated', () => {
    const catalog = new SharedTabCatalog()
    catalog.submit(create('local'))
    expect(catalog.bootstrap({ ...key, workspaceKey: 'folder:/srv/app' }).tabs).toEqual([])
    expect(
      catalog.bootstrap({ executionHostId: 'ssh:host-a', workspaceKey: key.workspaceKey }).tabs
    ).toEqual([])
  })

  it('hydrates equal tab IDs independently across folder, git, and SSH partitions', () => {
    const catalog = new SharedTabCatalog()
    const partitions = [
      key,
      { executionHostId: 'local' as const, workspaceKey: 'folder:/srv/app' },
      { executionHostId: 'ssh:host-a' as const, workspaceKey: key.workspaceKey }
    ]
    for (const [index, partition] of partitions.entries()) {
      catalog.submit({ ...create(`create-${index}`), key: partition })
    }
    expect(
      catalog
        .bootstrapAll()
        .map((partition) => [partition.key, partition.tabs.map((tab) => tab.tabId)])
    ).toEqual([
      [key, ['tab-1']],
      [partitions[1], ['tab-1']],
      [partitions[2], ['tab-1']]
    ])

    catalog.submit({
      mutationId: 'patch-folder',
      kind: 'patch',
      key: partitions[1],
      tabId: 'tab-1',
      metadata: { label: 'Folder' }
    })
    catalog.submit({ mutationId: 'close-ssh', kind: 'close', key: partitions[2], tabId: 'tab-1' })
    expect(catalog.bootstrap(key).tabs[0]?.metadata.label).toBe('Terminal')
    expect(catalog.bootstrap(partitions[1]).tabs[0]?.metadata.label).toBe('Folder')
    expect(catalog.bootstrap(partitions[2]).tabs).toEqual([])
    expect(catalog.bootstrap(partitions[2]).tombstones).toEqual(['tab-1'])
  })

  it('patches existing tabs but never resurrects a closed tab', () => {
    const catalog = new SharedTabCatalog()
    catalog.submit(create('a'))
    catalog.submit({
      mutationId: 'patch',
      kind: 'patch',
      key,
      tabId: 'tab-1',
      metadata: { label: 'Renamed' }
    })
    expect(catalog.bootstrap(key).tabs[0]?.metadata.label).toBe('Renamed')
    catalog.submit({ mutationId: 'close', kind: 'close', key, tabId: 'tab-1' })
    catalog.submit({
      mutationId: 'late-patch',
      kind: 'patch',
      key,
      tabId: 'tab-1',
      metadata: { label: 'Stale' }
    })
    expect(catalog.bootstrap(key).tabs).toEqual([])
  })

  it('does not let stale persisted bootstrap roll back a live tombstone', () => {
    const catalog = new SharedTabCatalog()
    catalog.submit(create('live'))
    catalog.submit({ mutationId: 'close-live', kind: 'close', key, tabId: 'tab-1' })
    catalog.importState({
      partitions: {
        [JSON.stringify([key.executionHostId, key.workspaceKey])]: {
          revision: 1,
          tabs: [
            {
              tabId: 'tab-1',
              contentType: 'terminal',
              metadata: { entityId: 'tab-1', label: 'Stale', customLabel: null, color: null },
              backingState: { kind: 'terminal', ptyIds: [] }
            }
          ],
          tombstones: []
        }
      }
    })
    expect(catalog.bootstrap(key).tabs).toEqual([])
    expect(catalog.bootstrap(key).tombstones).toEqual(['tab-1'])
  })

  it('applies remote metadata, backing, and terminal binding changes without resurrection', () => {
    const catalog = new SharedTabCatalog()
    const created = catalog.submit(create('remote-create'))
    expect(created.tab?.metadata.entityId).toBe('tab-1')
    const patched = catalog.submit({
      mutationId: 'remote-patch',
      kind: 'patch',
      key,
      tabId: 'tab-1',
      metadata: { label: 'Renamed', color: '#123456', isPinned: true },
      backingState: { kind: 'editor', filePath: '/repo/a.ts', language: 'typescript' }
    })
    expect(patched.tab?.metadata).toMatchObject({
      label: 'Renamed',
      color: '#123456',
      isPinned: true
    })
    expect(patched.tab?.backingState).toEqual({
      kind: 'editor',
      filePath: '/repo/a.ts',
      language: 'typescript'
    })
    const bound = catalog.submit({
      mutationId: 'remote-bind',
      kind: 'bind-terminal',
      key,
      tabId: 'tab-1',
      terminalBinding: { ptyId: 'pty-1', incarnationId: 'inc-1' }
    })
    expect(bound.tab?.terminalBinding).toEqual({ ptyId: 'pty-1', incarnationId: 'inc-1' })
    expect(
      catalog.submit({ mutationId: 'remote-close', kind: 'close', key, tabId: 'tab-1' }).tab
    ).toBeNull()
  })
})
