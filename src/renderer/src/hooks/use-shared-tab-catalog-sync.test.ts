// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../../shared/tab-types'
import type {
  SharedTabCatalogChange,
  SharedTabCatalogEntry,
  SharedTabCatalogKey
} from '../../../shared/shared-tab-catalog-types'
import { createTestStore } from '../store/slices/store-test-helpers'
import { useAppStore } from '../store'
import { projectSharedTabEntry } from './use-shared-tab-catalog-sync'
import { applySharedTabCatalogChange } from '../lib/shared-tab-catalog-reconciliation'
import { makeSyncedTabIdentity } from '../../../shared/synced-tab-identity'
import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { useSharedTabCatalogSync } from './use-shared-tab-catalog-sync'

const tab = (
  contentType: Tab['contentType'],
  entityId: string,
  worktreeId = 'repo::worktree'
): Tab => ({
  id: `tab-${contentType}-${entityId}`,
  entityId,
  groupId: 'local-group',
  worktreeId,
  executionHostId: 'local',
  contentType,
  label: contentType,
  customLabel: null,
  color: null,
  sortOrder: 0,
  createdAt: 1
})
function HookProbe(): null {
  useSharedTabCatalogSync()
  return null
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('shared catalog renderer projections', () => {
  it('mounts hook, gates startup on session hydration, and seeds after bootstrap', async () => {
    const store = useAppStore
    const mutations: unknown[] = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(async (mutation: unknown) => {
              mutations.push(mutation)
              return { tab: (mutation as { tab?: unknown }).tab ?? null }
            }),
            onCatalogChanged: vi.fn(() => () => undefined)
          }
        }
      }
    })
    store.setState({
      hydrationSucceeded: false,
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {}
    } as never)
    store.setState({
      openFiles: [
        {
          id: 'file-seed',
          filePath: '/repo/seed.ts',
          relativePath: 'seed.ts',
          worktreeId: 'repo::worktree',
          language: 'typescript',
          isDirty: false
        }
      ] as never
    })
    store
      .getState()
      .createUnifiedTab('repo::worktree', 'editor', {
        id: 'local-seed',
        entityId: 'file-seed',
        executionHostId: 'local',
        activate: false,
        recordInteraction: false
      })
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mutations).toHaveLength(0)
    await act(async () => {
      store.getState().setHydrationSucceeded(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mutations).toHaveLength(1)
    expect(
      (
        mutations[0] as {
          kind: string
          tab: {
            tabId: string
            catalogTabId?: string
            metadata: { entityId: string; catalogEntityId?: string }
          }
        }
      ).kind
    ).toBe('create')
    const seeded = mutations[0] as {
      tab: {
        tabId: string
        catalogTabId?: string
        metadata: { entityId: string; catalogEntityId?: string }
      }
    }
    expect(seeded.tab.tabId).toBe('local-seed')
    expect(seeded.tab.catalogTabId).toBe('local-seed')
    expect(seeded.tab.metadata.entityId).toMatch(/^stc_[0-9a-f]{64}$/)
    expect(seeded.tab.metadata.catalogEntityId).toBe('file-seed')
    expect(
      store
        .getState()
        .unifiedTabsByWorktree['repo::worktree']?.find((tab) => tab.catalogTabId === 'local-seed')
        ?.id
    ).toBe(
      makeSyncedTabIdentity({
        executionHostId: 'local',
        workspaceKey: 'repo::worktree',
        catalogTabId: 'local-seed'
      })
    )
    mounted.unmount()
  })

  it.each([
    ['acknowledgement before event', false],
    ['event before acknowledgement', true]
  ] as const)(
    'adopts one canonical identity without echo in mounted %s flow',
    async (_label, eventFirst) => {
      const store = useAppStore
      const calls: unknown[] = []
      const ack = deferred<{ tab: SharedTabCatalogEntry; revision: number }>()
      let listener: ((change: SharedTabCatalogChange) => void) | undefined
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          app: {
            tabs: {
              catalogBootstrapAll: vi.fn(async () => []),
              catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
              catalogMutate: vi.fn(async (mutation: unknown) => {
                calls.push(mutation)
                return ack.promise
              }),
              onCatalogChanged: vi.fn((next: (change: SharedTabCatalogChange) => void) => {
                listener = next
                return () => {
                  listener = undefined
                }
              })
            }
          }
        }
      })
      store.setState({
        hydrationSucceeded: true,
        unifiedTabsByWorktree: {},
        groupsByWorktree: {},
        activeGroupIdByWorktree: {},
        layoutByWorktree: {},
        openFiles: [],
        tabsByWorktree: {
          'repo::terminal': [
            {
              id: 'raw-terminal-entity',
              ptyId: null,
              worktreeId: 'repo::terminal',
              title: 'Terminal',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 0
            }
          ]
        }
      } as never)
      const mounted = render(createElement(HookProbe))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      store
        .getState()
        .createUnifiedTab('repo::flow', 'editor', {
          id: 'optimistic-tab',
          entityId: 'optimistic-entity',
          executionHostId: 'local',
          activate: false,
          recordInteraction: false
        })
      await act(async () => {
        await Promise.resolve()
      })
      expect(calls).toHaveLength(1)
      const mutation = calls[0] as {
        mutationId: string
        kind: 'create'
        key: SharedTabCatalogKey
        tab: SharedTabCatalogEntry
      }
      const adoptionWrites = vi.spyOn(store, 'setState')
      const canonical: SharedTabCatalogEntry = {
        ...mutation.tab,
        tabId: 'optimistic-tab',
        catalogTabId: 'optimistic-tab',
        metadata: {
          ...mutation.tab.metadata,
          entityId: makeSyncedTabIdentity(
            {
              executionHostId: 'local',
              workspaceKey: 'repo::flow',
              catalogTabId: 'optimistic-entity'
            },
            'entity'
          ),
          catalogEntityId: 'optimistic-entity'
        }
      }
      const change: SharedTabCatalogChange = { revision: 1, mutation, tab: canonical }
      await act(async () => {
        if (eventFirst) {
          listener?.(change)
        }
        ack.resolve({ tab: canonical, revision: 1 })
        await ack.promise
        if (!eventFirst) {
          listener?.(change)
        }
        await Promise.resolve()
      })
      const tabs = store.getState().unifiedTabsByWorktree['repo::flow'] ?? []
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toMatchObject({
        id: makeSyncedTabIdentity({
          executionHostId: 'local',
          workspaceKey: 'repo::flow',
          catalogTabId: 'optimistic-tab'
        }),
        catalogTabId: 'optimistic-tab',
        catalogEntityId: 'optimistic-entity'
      })
      expect(
        store.getState().openFiles.filter((file) => file.catalogEntityId === 'optimistic-entity')
      ).toHaveLength(1)
      listener?.({
        ...change,
        revision: 1,
        tab: { ...canonical, metadata: { ...canonical.metadata, label: 'stale' } }
      })
      listener?.({
        ...change,
        revision: 0,
        tab: { ...canonical, metadata: { ...canonical.metadata, label: 'older' } }
      })
      expect(store.getState().unifiedTabsByWorktree['repo::flow']?.[0]?.label).not.toBe('stale')
      expect(store.getState().unifiedTabsByWorktree['repo::flow']?.[0]?.label).not.toBe('older')
      expect(calls).toHaveLength(1)
      expect(adoptionWrites).toHaveBeenCalledTimes(1)
      adoptionWrites.mockRestore()
      mounted.unmount()
    }
  )

  it('fences event-first duplicate while acknowledgement remains pending', async () => {
    const store = useAppStore
    const ack = deferred<{ tab: SharedTabCatalogEntry }>()
    const calls: unknown[] = []
    let listener: ((change: SharedTabCatalogChange) => void) | undefined
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(async (mutation: unknown) => {
              calls.push(mutation)
              return ack.promise
            }),
            onCatalogChanged: vi.fn((next: (change: SharedTabCatalogChange) => void) => {
              listener = next
              return () => {
                listener = undefined
              }
            })
          }
        }
      }
    })
    store.setState({
      hydrationSucceeded: true,
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      openFiles: []
    } as never)
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    store
      .getState()
      .createUnifiedTab('repo::pending', 'editor', {
        id: 'pending-tab',
        entityId: 'pending-entity',
        executionHostId: 'local',
        activate: false,
        recordInteraction: false
      })
    await act(async () => {
      await Promise.resolve()
    })
    const mutation = calls[0] as {
      mutationId: string
      kind: 'create'
      key: SharedTabCatalogKey
      tab: SharedTabCatalogEntry
    }
    const change: SharedTabCatalogChange = { revision: 8, mutation, tab: mutation.tab }
    const writes = vi.spyOn(store, 'setState')
    await act(async () => {
      listener?.(change)
      listener?.(change)
      await Promise.resolve()
    })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(store.getState().unifiedTabsByWorktree['repo::pending']?.[0]?.id).toMatch(
      /^stc_[0-9a-f]{64}$/
    )
    writes.mockRestore()
    ack.resolve({ tab: mutation.tab })
    mounted.unmount()
  })

  it('retries same event after reducer failure without revision fence', async () => {
    const store = useAppStore
    const calls: unknown[] = []
    let listener: ((change: SharedTabCatalogChange) => void) | undefined
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(async (mutation: unknown) => {
              calls.push(mutation)
              return new Promise<never>(() => undefined)
            }),
            onCatalogChanged: vi.fn((next: (change: SharedTabCatalogChange) => void) => {
              listener = next
              return () => {
                listener = undefined
              }
            })
          }
        }
      }
    })
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const entry: SharedTabCatalogEntry = {
      tabId: 'retry-tab',
      contentType: 'editor',
      metadata: { entityId: 'retry-entity', label: 'Retry', customLabel: null, color: null },
      backingState: { kind: 'editor', filePath: '/retry.ts', language: 'typescript' }
    }
    const mutation = {
      mutationId: 'retry-create',
      kind: 'create' as const,
      key: { executionHostId: 'local' as const, workspaceKey: 'repo::retry' },
      tab: entry
    }
    const change: SharedTabCatalogChange = { revision: 11, mutation, tab: entry }
    const writes = vi.spyOn(store, 'setState').mockImplementationOnce(() => {
      throw new Error('reducer failed')
    })
    expect(() => listener?.(change)).toThrow('reducer failed')
    expect(writes).toHaveBeenCalledTimes(1)
    writes.mockRestore()
    expect(() => listener?.(change)).not.toThrow()
    expect(store.getState().unifiedTabsByWorktree['repo::retry']).toHaveLength(1)
    mounted.unmount()
  })

  it('atomically rejects conflicting mounted create and removes raw backing', async () => {
    const store = useAppStore
    const ack = deferred<{ tab: SharedTabCatalogEntry; revision: number }>()
    const calls: unknown[] = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(async (mutation: unknown) => {
              calls.push(mutation)
              return ack.promise
            }),
            onCatalogChanged: vi.fn(() => () => undefined)
          }
        }
      }
    })
    store.setState({
      hydrationSucceeded: true,
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      openFiles: []
    } as never)
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    store
      .getState()
      .createUnifiedTab('repo::conflict', 'editor', {
        id: 'raw-tab',
        entityId: 'raw-entity',
        executionHostId: 'local',
        activate: false,
        recordInteraction: false
      })
    await act(async () => {
      await Promise.resolve()
    })
    const mutation = calls[0] as {
      mutationId: string
      kind: 'create'
      key: SharedTabCatalogKey
      tab: SharedTabCatalogEntry
    }
    const conflicting: SharedTabCatalogEntry = {
      ...mutation.tab,
      contentType: 'terminal',
      metadata: {
        ...mutation.tab.metadata,
        entityId: 'other-entity',
        catalogEntityId: 'other-entity'
      },
      backingState: { kind: 'terminal', ptyIds: ['other-pty'] }
    }
    const writes = vi.spyOn(store, 'setState')
    await act(async () => {
      ack.resolve({ tab: conflicting, revision: 2 })
      await ack.promise
      await Promise.resolve()
    })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(store.getState().unifiedTabsByWorktree['repo::conflict'] ?? []).toHaveLength(0)
    writes.mockRestore()
    mounted.unmount()
  })

  it('scopes ack adoption by candidate host and workspace for equal catalog IDs', async () => {
    const store = useAppStore
    const calls: {
      mutation: { kind: 'create'; key: SharedTabCatalogKey; tab: SharedTabCatalogEntry }
      resolve: (value: { tab: SharedTabCatalogEntry; revision: number }) => void
    }[] = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(
              (mutation: {
                kind: 'create'
                key: SharedTabCatalogKey
                tab: SharedTabCatalogEntry
              }) =>
                new Promise<{ tab: SharedTabCatalogEntry; revision: number }>((resolve) => {
                  calls.push({ mutation, resolve })
                })
            ),
            onCatalogChanged: vi.fn(() => () => undefined)
          }
        }
      }
    })
    const foreignFile = {
      id: 'same-entity',
      filePath: '/foreign.ts',
      relativePath: 'foreign.ts',
      worktreeId: 'folder::same',
      language: 'typescript',
      isDirty: true
    }
    store.setState({
      hydrationSucceeded: true,
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      openFiles: [
        {
          id: 'same-entity',
          filePath: '/target.ts',
          relativePath: 'target.ts',
          worktreeId: 'repo::same',
          language: 'typescript',
          isDirty: false
        },
        foreignFile
      ]
    } as never)
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    store
      .getState()
      .createUnifiedTab('repo::same', 'editor', {
        id: 'same-tab',
        entityId: 'same-entity',
        executionHostId: 'local',
        activate: false,
        recordInteraction: false
      })
    store
      .getState()
      .createUnifiedTab('folder::same', 'editor', {
        id: 'same-tab',
        entityId: 'same-entity',
        executionHostId: 'ssh:other',
        activate: false,
        recordInteraction: false
      })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    store.setState({
      openFiles: [
        {
          id: 'same-entity',
          filePath: '/target.ts',
          relativePath: 'target.ts',
          worktreeId: 'repo::same',
          language: 'typescript',
          isDirty: false
        },
        foreignFile
      ]
    } as never)
    expect(store.getState().openFiles).toHaveLength(2)
    expect(calls).toHaveLength(2)
    const target = calls.find((call) => call.mutation.key.executionHostId === 'local')!
    const writes = vi.spyOn(store, 'setState')
    await act(async () => {
      target.resolve({ tab: target.mutation.tab, revision: 4 })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writes).toHaveBeenCalledTimes(1)
    const tabs = Object.values(store.getState().unifiedTabsByWorktree).flat()
    expect(tabs.find((item) => item.worktreeId === 'repo::same')?.id).toMatch(/^stc_[0-9a-f]{64}$/)
    expect(tabs.find((item) => item.worktreeId === 'folder::same')?.id).toBe('same-tab')
    expect(store.getState().openFiles.find((file) => file.worktreeId === 'repo::same')?.id).toMatch(
      /^stc_[0-9a-f]{64}$/
    )
    expect(store.getState().openFiles.find((file) => file.worktreeId === 'folder::same')).toEqual(
      foreignFile
    )
    writes.mockRestore()
    mounted.unmount()
  })

  it('adopts mounted terminal through one planner-backed write', async () => {
    const store = useAppStore
    const ack = deferred<{ tab: SharedTabCatalogEntry; revision: number }>()
    let mutation:
      | { kind: 'create'; key: SharedTabCatalogKey; tab: SharedTabCatalogEntry }
      | undefined
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        app: {
          tabs: {
            catalogBootstrapAll: vi.fn(async () => []),
            catalogBootstrap: vi.fn(async () => ({ revision: 0, tabs: [], tombstones: [] })),
            catalogMutate: vi.fn(async (value: typeof mutation) => {
              mutation = value
              return ack.promise
            }),
            onCatalogChanged: vi.fn(() => () => undefined)
          }
        }
      }
    })
    store.setState({
      hydrationSucceeded: true,
      unifiedTabsByWorktree: {},
      groupsByWorktree: {},
      activeGroupIdByWorktree: {},
      layoutByWorktree: {},
      openFiles: []
    } as never)
    const mounted = render(createElement(HookProbe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    store
      .getState()
      .createUnifiedTab('repo::terminal', 'terminal', {
        id: 'raw-terminal',
        entityId: 'raw-terminal-entity',
        executionHostId: 'local',
        activate: false,
        recordInteraction: false
      })
    await act(async () => {
      await Promise.resolve()
    })
    const writes = vi.spyOn(store, 'setState')
    const canonical = mutation!.tab
    ack.resolve({ tab: canonical, revision: 5 })
    await act(async () => {
      await ack.promise
      await Promise.resolve()
    })
    expect(writes).toHaveBeenCalledTimes(1)
    expect(store.getState().unifiedTabsByWorktree['repo::terminal']?.[0]?.id).toMatch(
      /^stc_[0-9a-f]{64}$/
    )
    expect(store.getState().tabsByWorktree['repo::terminal']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^stc_[0-9a-f]{64}$/) })
      ])
    )
    writes.mockRestore()
    mounted.unmount()
  })
  it('applies remote create in background through canonical handler', () => {
    const store = createTestStore()
    const before = store.getState().activeTabId
    applySharedTabCatalogChange(
      {
        revision: 1,
        mutation: {
          mutationId: 'create',
          kind: 'create',
          key: { executionHostId: 'local', workspaceKey: 'repo::worktree' },
          tab: {
            tabId: 'remote-1',
            contentType: 'editor',
            metadata: { entityId: 'file-1', label: 'Remote', customLabel: null, color: null },
            backingState: { kind: 'editor', filePath: '/repo/file.ts', language: 'typescript' }
          }
        },
        tab: {
          tabId: 'remote-1',
          contentType: 'editor',
          metadata: { entityId: 'file-1', label: 'Remote', customLabel: null, color: null },
          backingState: { kind: 'editor', filePath: '/repo/file.ts', language: 'typescript' }
        }
      },
      store
    )
    expect(store.getState().unifiedTabsByWorktree['repo::worktree']?.[0]).toMatchObject({
      id: makeSyncedTabIdentity({
        executionHostId: 'local',
        workspaceKey: 'repo::worktree',
        catalogTabId: 'remote-1'
      }),
      catalogTabId: 'remote-1',
      catalogEntityId: 'file-1',
      label: 'Remote'
    })
    expect(store.getState().activeTabId).toBe(before)
  })
  it('projects real terminal PTY binding without changing terminal entity identity', () => {
    const store = createTestStore()
    store.setState({
      ptyIdsByTabId: {
        [makeSyncedTabIdentity(
          { executionHostId: 'local', workspaceKey: 'repo::worktree', catalogTabId: 'terminal-1' },
          'entity'
        )]: ['pty-1']
      }
    })
    const projected = projectSharedTabEntry(tab('terminal', 'terminal-1'), store.getState())
    expect(projected.metadata.entityId).toBe(
      makeSyncedTabIdentity(
        { executionHostId: 'local', workspaceKey: 'repo::worktree', catalogTabId: 'terminal-1' },
        'entity'
      )
    )
    expect(projected.metadata.catalogEntityId).toBe('terminal-1')
    expect(projected.terminalBinding).toEqual({ ptyId: 'pty-1' })
    expect(projected.backingState).toEqual({ kind: 'terminal', ptyIds: ['pty-1'] })
  })

  it.each([
    [
      'editor',
      { id: 'file-1', filePath: '/repo/a.ts', worktreeId: 'repo::worktree', language: 'typescript' }
    ],
    [
      'diff',
      { id: 'file-2', filePath: '/repo/b.ts', worktreeId: 'repo::worktree', language: 'typescript' }
    ],
    [
      'conflict-review',
      { id: 'file-3', filePath: '/repo/c.ts', worktreeId: 'repo::worktree', language: 'typescript' }
    ],
    [
      'check-details',
      { id: 'file-4', filePath: '/repo/d.ts', worktreeId: 'repo::worktree', language: 'typescript' }
    ]
  ] as const)('projects %s from open-file backing state', (contentType, file) => {
    const store = createTestStore()
    store.setState({ openFiles: [file] as never })
    const projected = projectSharedTabEntry(tab(contentType, file.id), store.getState())
    expect(projected.backingState).toMatchObject({
      kind: 'editor',
      filePath: file.filePath,
      language: 'typescript'
    })
  })

  it('projects browser workspace/page backing and simulator identity', () => {
    const store = createTestStore()
    store.setState({
      browserTabsByWorktree: {
        'repo::worktree': [
          {
            id: 'browser-1',
            worktreeId: 'repo::worktree',
            pageIds: ['page-1'],
            url: 'https://example.test',
            title: 'Example'
          }
        ]
      } as never
    })
    expect(
      projectSharedTabEntry(tab('browser', 'browser-1'), store.getState()).backingState
    ).toMatchObject({ kind: 'browser', browserWorkspaceId: 'browser-1', pages: ['page-1'] })
    expect(projectSharedTabEntry(tab('simulator', 'sim-1'), store.getState()).backingState).toEqual(
      {
        kind: 'simulator',
        simulatorId: makeSyncedTabIdentity(
          { executionHostId: 'local', workspaceKey: 'repo::worktree', catalogTabId: 'sim-1' },
          'entity'
        )
      }
    )
  })

  it('materializes missing editor backing and clears a remote terminal binding', () => {
    const store = createTestStore()
    const editor = tab('editor', 'missing-file')
    const terminal = tab('terminal', 'terminal-2')
    store
      .getState()
      .createUnifiedTab('repo::worktree', 'editor', {
        id: editor.id,
        entityId: editor.entityId,
        activate: false,
        recordInteraction: false
      })
    store
      .getState()
      .createUnifiedTab('repo::worktree', 'terminal', {
        id: terminal.id,
        entityId: terminal.entityId,
        activate: false,
        recordInteraction: false
      })
    store.setState({ ptyIdsByTabId: { [terminal.id]: ['pty-old'] } })
    const key = { executionHostId: 'local' as const, workspaceKey: 'repo::worktree' }
    applySharedTabCatalogChange(
      {
        revision: 1,
        mutation: {
          mutationId: 'patch',
          kind: 'patch',
          key,
          tabId: editor.id,
          backingState: { kind: 'editor', filePath: '/repo/missing.ts', language: 'typescript' }
        },
        tab: {
          tabId: editor.id,
          contentType: 'editor',
          metadata: {
            entityId: editor.entityId,
            label: editor.label,
            customLabel: null,
            color: null
          },
          backingState: { kind: 'editor', filePath: '/repo/missing.ts', language: 'typescript' }
        }
      },
      store
    )
    applySharedTabCatalogChange(
      {
        revision: 2,
        mutation: {
          mutationId: 'unbind',
          kind: 'bind-terminal',
          key,
          tabId: terminal.id,
          terminalBinding: null
        },
        tab: {
          tabId: terminal.id,
          contentType: 'terminal',
          metadata: {
            entityId: terminal.entityId,
            label: terminal.label,
            customLabel: null,
            color: null
          },
          backingState: { kind: 'terminal', ptyIds: [] },
          terminalBinding: null
        }
      },
      store
    )
    expect(store.getState().openFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: editor.entityId, filePath: '/repo/missing.ts' })
      ])
    )
    expect(store.getState().ptyIdsByTabId[terminal.entityId]).toEqual([])
  })

  it('keeps equal tab IDs scoped by workspace and execution host in catalog identity', () => {
    const first = tab('editor', 'same', 'repo::local')
    const second = {
      ...tab('editor', 'same', 'folder:/tmp/project'),
      executionHostId: 'ssh:host-a' as const
    }
    expect(`${first.executionHostId}:${first.worktreeId}:${first.id}`).not.toBe(
      `${second.executionHostId}:${second.worktreeId}:${second.id}`
    )
  })

  it('closes and binds equal tab IDs independently by host', () => {
    const store = createTestStore()
    const keys: SharedTabCatalogKey[] = ['local', 'runtime:folder', 'ssh:remote'].map(
      (executionHostId) => ({
        executionHostId: executionHostId as SharedTabCatalogKey['executionHostId'],
        workspaceKey: 'repo::same'
      })
    )
    for (const [index, key] of keys.entries()) {
      const metadata = {
        entityId: `entity-${index}`,
        label: `tab-${index}`,
        customLabel: null,
        color: null
      }
      const entry = {
        tabId: 'same',
        contentType: 'terminal' as const,
        metadata,
        backingState: { kind: 'terminal' as const, ptyIds: [`pty-${index}`] },
        terminalBinding: { ptyId: `pty-${index}` }
      }
      applySharedTabCatalogChange(
        {
          revision: 1,
          mutation: { mutationId: `create-${index}`, kind: 'create', key, tab: entry },
          tab: entry
        },
        store
      )
    }
    applySharedTabCatalogChange(
      {
        revision: 2,
        mutation: {
          mutationId: 'bind-ssh',
          kind: 'bind-terminal',
          key: keys[2]!,
          tabId: 'same',
          terminalBinding: { ptyId: 'pty-ssh-new' }
        },
        tab: {
          tabId: 'same',
          contentType: 'terminal',
          metadata: { entityId: 'entity-2', label: 'tab-2', customLabel: null, color: null },
          backingState: { kind: 'terminal', ptyIds: ['pty-ssh-new'] },
          terminalBinding: { ptyId: 'pty-ssh-new' }
        }
      },
      store
    )
    applySharedTabCatalogChange(
      {
        revision: 3,
        mutation: { mutationId: 'close-local', kind: 'close', key: keys[0]!, tabId: 'same' },
        tab: null
      },
      store
    )
    const remaining = Object.values(store.getState().unifiedTabsByWorktree)
      .flat()
      .filter((candidate) => candidate.catalogTabId === 'same')
    expect(remaining).toHaveLength(2)
    expect(
      remaining
        .map((candidate) => candidate.executionHostId)
        .sort((left, right) => (left ?? '').localeCompare(right ?? ''))
    ).toEqual(['runtime:folder', 'ssh:remote'])
    expect(
      store.getState().ptyIdsByTabId[
        makeSyncedTabIdentity(
          { executionHostId: 'ssh:remote', workspaceKey: 'repo::same', catalogTabId: 'entity-2' },
          'entity'
        )
      ]
    ).toEqual(['pty-ssh-new'])
  })

  it('materializes every remote backing family and rebases tombstone acknowledgements', () => {
    const store = createTestStore()
    const key = { executionHostId: 'local' as const, workspaceKey: 'repo::worktree' }
    const entries = [
      {
        tabId: 'remote-terminal',
        contentType: 'terminal' as const,
        backingState: { kind: 'terminal' as const, ptyIds: ['pty-remote'] },
        terminalBinding: { ptyId: 'pty-remote' }
      },
      {
        tabId: 'remote-editor',
        contentType: 'editor' as const,
        backingState: {
          kind: 'editor' as const,
          filePath: '/repo/remote.ts',
          language: 'typescript'
        }
      },
      {
        tabId: 'remote-browser',
        contentType: 'browser' as const,
        backingState: {
          kind: 'browser' as const,
          browserWorkspaceId: 'browser-remote',
          pages: ['page-remote']
        }
      },
      {
        tabId: 'remote-simulator',
        contentType: 'simulator' as const,
        backingState: { kind: 'simulator' as const, simulatorId: 'sim-remote' }
      }
    ]
    for (const entry of entries) {
      const metadata = { entityId: entry.tabId, label: entry.tabId, customLabel: null, color: null }
      applySharedTabCatalogChange(
        {
          revision: 1,
          mutation: {
            mutationId: `create-${entry.tabId}`,
            kind: 'create',
            key,
            tab: { ...entry, metadata }
          },
          tab: { ...entry, metadata }
        },
        store
      )
    }
    const state = store.getState()
    const remoteTerminalId = makeSyncedTabIdentity(
      { executionHostId: 'local', workspaceKey: 'repo::worktree', catalogTabId: 'remote-terminal' },
      'entity'
    )
    expect(state.ptyIdsByTabId[remoteTerminalId]).toEqual(['pty-remote'])
    expect(state.openFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: makeSyncedTabIdentity(
            {
              executionHostId: 'local',
              workspaceKey: 'repo::worktree',
              catalogTabId: 'remote-editor'
            },
            'entity'
          ),
          catalogEntityId: 'remote-editor',
          filePath: '/repo/remote.ts'
        })
      ])
    )
    expect(state.browserTabsByWorktree['repo::worktree']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: makeSyncedTabIdentity(
            {
              executionHostId: 'local',
              workspaceKey: 'repo::worktree',
              catalogTabId: 'remote-browser'
            },
            'entity'
          ),
          catalogEntityId: 'remote-browser',
          pageIds: [
            makeSyncedTabIdentity(
              {
                executionHostId: 'local',
                workspaceKey: 'repo::worktree',
                catalogTabId: 'page-remote'
              },
              'page'
            )
          ]
        })
      ])
    )
    expect(state.unifiedTabsByWorktree['repo::worktree']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: makeSyncedTabIdentity({
            executionHostId: 'local',
            workspaceKey: 'repo::worktree',
            catalogTabId: 'remote-simulator'
          }),
          catalogTabId: 'remote-simulator',
          contentType: 'simulator'
        })
      ])
    )
    const terminalMetadata = {
      entityId: 'remote-terminal',
      label: 'remote-terminal',
      customLabel: null,
      color: null
    }
    applySharedTabCatalogChange(
      {
        revision: 2,
        mutation: { mutationId: 'close-terminal', kind: 'close', key, tabId: 'remote-terminal' },
        tab: null
      },
      store
    )
    applySharedTabCatalogChange(
      {
        revision: 3,
        mutation: {
          mutationId: 'late-create',
          kind: 'create',
          key,
          tab: { ...entries[0], metadata: terminalMetadata }
        },
        tab: null
      },
      store
    )
    expect(store.getState().ptyIdsByTabId['remote-terminal'] ?? []).toEqual([])
    expect(store.getState().unifiedTabsByWorktree['repo::worktree']).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'remote-terminal' })])
    )
  })
})
