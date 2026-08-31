import { describe, expect, it } from 'vitest'
import { createTestStore } from '../store/slices/store-test-helpers'
import { makeSyncedTabIdentity } from '../../../shared/synced-tab-identity'
import {
  migrateSyncedTabIdentity,
  planSyncedTabIdentityMigration
} from './synced-tab-identity-migration'

function browserMigrationFixture(workspaceKey = 'browser-wt') {
  const store = createTestStore()
  store
    .getState()
    .createUnifiedTab(workspaceKey, 'browser', {
      id: 'source-tab',
      activate: false,
      recordInteraction: false
    })
  store.setState({
    unifiedTabsByWorktree: {
      [workspaceKey]: store
        .getState()
        .unifiedTabsByWorktree[workspaceKey]!.map((tab) => ({
          ...tab,
          id: 'source-tab',
          entityId: 'source-browser-entity',
          catalogTabId: 'canonical-tab',
          catalogEntityId: 'canonical-entity',
          executionHostId: 'ssh:browser' as never
        }))
    }
  })
  const sourceWorkspace = {
    id: 'browser-source-workspace',
    catalogEntityId: 'canonical-entity',
    worktreeId: workspaceKey,
    url: 'about:blank',
    title: 'Source',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 1,
    pageIds: ['live-page'],
    activePageId: 'live-page'
  }
  const livePage = {
    id: 'live-page',
    catalogPageId: 'live-page',
    workspaceId: sourceWorkspace.id,
    worktreeId: workspaceKey,
    url: 'about:blank',
    title: 'Live',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 1
  }
  store.setState({
    browserTabsByWorktree: { [workspaceKey]: [sourceWorkspace] },
    browserPagesByWorkspace: { [sourceWorkspace.id]: [livePage] }
  })
  return {
    store,
    sourceWorkspace,
    livePage,
    destinationEntity: makeSyncedTabIdentity(
      { executionHostId: 'ssh:browser', workspaceKey, catalogTabId: 'canonical-entity' },
      'entity'
    ),
    tuple: {
      executionHostId: 'ssh:browser' as const,
      workspaceKey,
      catalogTabId: 'canonical-tab',
      catalogEntityId: 'canonical-entity'
    }
  }
}

function terminalMigrationFixture(
  workspaceKey = 'terminal-wt',
  sourceEntity = 'source-terminal-entity'
) {
  const store = createTestStore()
  store
    .getState()
    .createUnifiedTab(workspaceKey, 'terminal', {
      id: 'source-tab',
      activate: false,
      recordInteraction: false
    })
  const sourceTab = store.getState().unifiedTabsByWorktree[workspaceKey]![0]!
  const tuple = {
    executionHostId: 'ssh:terminal' as const,
    workspaceKey,
    catalogTabId: 'canonical-tab',
    catalogEntityId: 'canonical-entity'
  }
  const destinationEntity = makeSyncedTabIdentity(
    { ...tuple, catalogTabId: tuple.catalogEntityId },
    'entity'
  )
  store.setState({
    unifiedTabsByWorktree: {
      [workspaceKey]: [
        {
          ...sourceTab,
          id: 'source-tab',
          entityId: sourceEntity,
          catalogTabId: tuple.catalogTabId,
          catalogEntityId: tuple.catalogEntityId,
          executionHostId: tuple.executionHostId as never
        }
      ]
    },
    tabsByWorktree: {
      [workspaceKey]: [
        {
          id: sourceEntity,
          ptyId: null,
          worktreeId: workspaceKey,
          title: 'source',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ] as never[]
    }
  })
  return { store, tuple, sourceEntity, destinationEntity }
}

describe('synced tab identity migration', () => {
  it('uses fixed-size opaque identities', () => {
    const identity = makeSyncedTabIdentity({
      executionHostId: 'ssh:host-a',
      workspaceKey: 'folder:/tmp/a-b',
      catalogTabId: 'tab-x'
    })
    expect(identity).toMatch(/^stc_[a-f0-9]{64}$/)
    expect(identity).not.toContain('host-a')
  })

  it('matches the deterministic tuple digest vector', () => {
    expect(makeSyncedTabIdentity({ workspaceKey: 'workspace', catalogTabId: 'catalog' })).toBe(
      'stc_3c382c99c5e69d5c9fa29e5f67b5409da56f54ee6ceb77965224e52e0800d9ba'
    )
  })

  it('isolates every tuple dimension and identity domain', () => {
    const tuple = { workspaceKey: 'workspace', catalogTabId: 'catalog' }
    const base = makeSyncedTabIdentity(tuple)
    expect(makeSyncedTabIdentity({ ...tuple, executionHostId: 'ssh:host' })).not.toBe(base)
    expect(makeSyncedTabIdentity({ ...tuple, workspaceKey: 'workspace/other' })).not.toBe(base)
    expect(makeSyncedTabIdentity({ ...tuple, catalogTabId: 'catalog/other' })).not.toBe(base)
    expect(makeSyncedTabIdentity(tuple, 'entity')).not.toBe(base)
    expect(makeSyncedTabIdentity(tuple, 'page')).not.toBe(base)
    expect(makeSyncedTabIdentity({ ...tuple, executionHostId: 'local' })).toBe(base)
  })

  it('keeps delimiter, Unicode, and long tuples opaque at fixed size', () => {
    const identity = makeSyncedTabIdentity({
      executionHostId: 'ssh:💻|.',
      workspaceKey: 'a.b|c/∆'.repeat(1000),
      catalogTabId: '日本語|.'
    })
    expect(identity).toMatch(/^stc_[a-f0-9]{64}$/)
    expect(identity).not.toContain('日本語')
    const first = makeSyncedTabIdentity({
      executionHostId: 'ssh:host',
      workspaceKey: 'a:b',
      catalogTabId: 'c'
    })
    const second = makeSyncedTabIdentity({
      executionHostId: 'ssh:host',
      workspaceKey: 'a',
      catalogTabId: 'b:c'
    })
    expect(first).not.toBe(second)
    const third = makeSyncedTabIdentity({
      executionHostId: 'ssh:host',
      workspaceKey: 'a|b',
      catalogTabId: 'c'
    })
    const fourth = makeSyncedTabIdentity({
      executionHostId: 'ssh:host',
      workspaceKey: 'a',
      catalogTabId: 'b|c'
    })
    expect(third).not.toBe(fourth)
  })

  it('migrates an omitted host as explicit local atomically', () => {
    const { store, tuple } = browserMigrationFixture('local-wt')
    store
      .getState()
      .createUnifiedTab('other-wt', 'browser', {
        id: 'other-tab',
        activate: false,
        recordInteraction: false
      })
    const otherTab = store.getState().unifiedTabsByWorktree['other-wt']![0]!
    store.setState({
      unifiedTabsByWorktree: {
        ...store.getState().unifiedTabsByWorktree,
        'local-wt': store
          .getState()
          .unifiedTabsByWorktree['local-wt']!.map((tab) => ({ ...tab, executionHostId: undefined }))
      }
    })
    const localTuple = {
      executionHostId: 'local' as const,
      workspaceKey: tuple.workspaceKey,
      catalogTabId: tuple.catalogTabId,
      catalogEntityId: tuple.catalogEntityId
    }
    const unrelated = [otherTab]
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    const identity = migrateSyncedTabIdentity(store, localTuple, 'source-tab')
    expect(identity).toBe(makeSyncedTabIdentity(localTuple))
    expect(identity).toMatch(/^stc_[a-f0-9]{64}$/)
    expect(writes).toBe(1)
    expect(store.getState().unifiedTabsByWorktree['local-wt']?.[0]?.id).toBe(identity)
    expect(store.getState().unifiedTabsByWorktree['other-wt']).toEqual(unrelated)
    expect(store.getState().unifiedTabsByWorktree['other-wt']?.[0]).toMatchObject({
      id: 'other-tab',
      contentType: 'browser'
    })
  })

  it('migrates tab, group, terminal, and editor keys in one commit', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('repo::same', 'terminal', {
        id: 'source-tab',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        'repo::same': store
          .getState()
          .unifiedTabsByWorktree['repo::same']!.map((tab) => ({
            ...tab,
            id: 'source-tab',
            entityId: 'source-terminal-entity',
            catalogTabId: 'canonical-tab',
            catalogEntityId: 'canonical-entity',
            executionHostId: 'ssh:host-a' as never
          }))
      }
    })
    store.setState({
      tabsByWorktree: {
        'repo::same': [
          {
            id: 'source-terminal-entity',
            ptyId: null,
            worktreeId: 'repo::same',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ] as never[]
      }
    })
    store.setState({
      ptyIdsByTabId: { 'source-terminal-entity': ['pty-1'] },
      terminalLayoutsByTabId: {
        'source-terminal-entity': { root: null, activeLeafId: null, expandedLeafId: null }
      },
      editorDrafts: { 'source-terminal-entity': 'draft' },
      editorViewMode: { 'source-terminal-entity': 'edit' },
      activeFileId: 'source-terminal-entity',
      activeFileIdByWorktree: { 'repo::same': 'source-terminal-entity' },
      openFiles: [{ id: 'source-terminal-entity', worktreeId: 'repo::same' } as never],
      unreadTerminalPanes: { 'source-terminal-entity:leaf': true },
      unreadAgentCompletionPanes: { 'source-terminal-entity:leaf': true },
      agentStatusByPaneKey: { 'source-terminal-entity:leaf': {} as never }
    })
    let commits = 0
    const originalSetState = store.setState
    store.setState = ((...args: Parameters<typeof originalSetState>) => {
      commits++
      return originalSetState(...args)
    }) as typeof originalSetState
    const identity = migrateSyncedTabIdentity(
      store,
      {
        executionHostId: 'ssh:host-a',
        workspaceKey: 'repo::same',
        catalogTabId: 'canonical-tab',
        catalogEntityId: 'canonical-entity'
      },
      'source-tab'
    )
    expect(identity).not.toBeNull()
    const state = store.getState()
    if (!identity) {
      return
    }
    const destinationEntityId = makeSyncedTabIdentity(
      {
        executionHostId: 'ssh:host-a',
        workspaceKey: 'repo::same',
        catalogTabId: 'canonical-entity'
      },
      'entity'
    )
    expect(commits).toBe(1)
    expect(state.unifiedTabsByWorktree['repo::same']?.[0]?.id).toBe(identity)
    expect(state.unifiedTabsByWorktree['repo::same']?.[0]?.entityId).toBe(destinationEntityId)
    const destinationTerminalTabs = state.tabsByWorktree['repo::same']?.filter(
      (tab) => tab.id === destinationEntityId
    )
    expect(destinationTerminalTabs).toHaveLength(1)
    expect(destinationTerminalTabs?.[0]).toMatchObject({
      id: destinationEntityId,
      catalogTabId: 'canonical-tab',
      catalogEntityId: 'canonical-entity'
    })
    expect(
      state.tabsByWorktree['repo::same']?.some((tab) => tab.id === 'source-terminal-entity')
    ).toBe(false)
    expect(state.groupsByWorktree['repo::same']?.[0]?.tabOrder).toContain(identity)
    const sourceEntity = makeSyncedTabIdentity(
      {
        executionHostId: 'ssh:host-a',
        workspaceKey: 'repo::same',
        catalogTabId: 'canonical-entity'
      },
      'entity'
    )
    expect(state.ptyIdsByTabId[sourceEntity]).toEqual(['pty-1'])
    expect(state.terminalLayoutsByTabId[sourceEntity]).toBeDefined()
    expect(state.editorDrafts[sourceEntity]).toBe('draft')
    expect(state.activeFileId).toBe(sourceEntity)
  })

  it('migrates browser workspace, pages, relationships, and page-backed maps atomically', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('repo::same', 'browser', {
        id: 'tab-1',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        'repo::same': store
          .getState()
          .unifiedTabsByWorktree['repo::same']!.map((tab) => ({
            ...tab,
            executionHostId: 'ssh:browser' as never
          }))
      }
    })
    store.setState({
      unifiedTabsByWorktree: {
        'repo::same': store
          .getState()
          .unifiedTabsByWorktree['repo::same']!.map((tab) => ({
            ...tab,
            entityId: 'source-browser-entity'
          }))
      }
    })
    const page = {
      id: 'page-1',
      workspaceId: 'browser-workspace-raw',
      worktreeId: 'repo::same',
      url: 'https://example.test',
      title: 'Example',
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 1
    }
    const workspace = {
      id: 'browser-workspace-raw',
      catalogEntityId: 'entity-1',
      worktreeId: 'repo::same',
      url: page.url,
      title: page.title,
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 1,
      pageIds: [page.id],
      activePageId: page.id
    }
    store.setState({
      browserTabsByWorktree: {
        'repo::same': [workspace],
        'other-wt': [{ ...workspace, worktreeId: 'other-wt' }]
      },
      browserPagesByWorkspace: {
        'browser-workspace-raw': [page],
        'other-browser': [{ ...page, workspaceId: 'other-browser', worktreeId: 'other-wt' }]
      },
      browserCertificateFailuresByPageId: {
        'page-1': {
          challengeId: 'c',
          browserPageId: 'page-1',
          errorCode: null,
          error: 'x',
          origin: 'https://example.test',
          displayHost: 'example.test',
          canProceed: true,
          observedAt: 1
        }
      },
      browserAnnotationsByPageId: {
        'page-1': [
          {
            id: 'annotation-1',
            browserPageId: 'page-1',
            comment: 'keep',
            intent: 'question',
            priority: 'important',
            createdAt: 'now',
            payload: {}
          }
        ] as never[]
      },
      remoteBrowserPageHandlesByPageId: {
        'page-1': { environmentId: 'env', remotePageId: 'remote' }
      },
      pendingAddressBarFocusByPageId: { 'page-1': true },
      pendingAddressBarFocusByTabId: { 'tab-1': true }
    })
    let commits = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      commits++
      return original(...args)
    }) as typeof original
    const id = migrateSyncedTabIdentity(
      store,
      {
        executionHostId: 'ssh:browser',
        workspaceKey: 'repo::same',
        catalogTabId: 'tab-1',
        catalogEntityId: 'entity-1'
      },
      'tab-1'
    )!
    const state = store.getState()
    const pageId = makeSyncedTabIdentity(
      { executionHostId: 'ssh:browser', workspaceKey: 'repo::same', catalogTabId: 'page-1' },
      'page'
    )
    const destinationEntity = makeSyncedTabIdentity(
      { executionHostId: 'ssh:browser', workspaceKey: 'repo::same', catalogTabId: 'entity-1' },
      'entity'
    )
    expect(commits).toBe(1)
    expect(state.browserTabsByWorktree['repo::same']?.[0]?.id).toBe(destinationEntity)
    expect(state.browserTabsByWorktree['repo::same']?.[0]?.catalogEntityId).toBe('entity-1')
    expect(state.browserTabsByWorktree['repo::same']?.[0]?.pageIds).toEqual([pageId])
    expect(state.browserPagesByWorkspace[destinationEntity]?.[0]).toMatchObject({
      id: pageId,
      workspaceId: destinationEntity
    })
    expect(state.browserTabsByWorktree['other-wt']?.[0]).toEqual({
      ...workspace,
      worktreeId: 'other-wt'
    })
    expect(state.browserPagesByWorkspace['other-browser']?.[0]).toEqual({
      ...page,
      workspaceId: 'other-browser',
      worktreeId: 'other-wt'
    })
    expect(state.browserCertificateFailuresByPageId[pageId]).toBeDefined()
    expect(state.browserAnnotationsByPageId[pageId]?.[0]?.browserPageId).toBe(pageId)
    expect(state.remoteBrowserPageHandlesByPageId[pageId]).toBeDefined()
    expect(state.pendingAddressBarFocusByPageId[pageId]).toBe(true)
    expect(state.pendingAddressBarFocusByTabId[id]).toBe(true)
  })

  it('preserves browser backing when workspace and page IDs already equal destinations', () => {
    const fixture = browserMigrationFixture('browser-self')
    const { store, tuple, livePage, destinationEntity } = fixture
    const pageId = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    const workspace = {
      ...fixture.sourceWorkspace,
      id: destinationEntity,
      pageIds: [pageId],
      activePageId: pageId
    }
    const page = { ...livePage, id: pageId, workspaceId: destinationEntity }
    store.setState({
      browserTabsByWorktree: { 'browser-self': [workspace] },
      browserPagesByWorkspace: { [destinationEntity]: [page] },
      browserAnnotationsByPageId: {
        [pageId]: [{ id: 'annotation', browserPageId: pageId }] as never[]
      }
    })
    const beforePages = store.getState().browserPagesByWorkspace
    const beforeAnnotations = store.getState().browserAnnotationsByPageId
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(migrateSyncedTabIdentity(store, tuple, 'source-tab')).not.toBeNull()
    expect(writes).toBe(1)
    expect(store.getState().browserPagesByWorkspace).toEqual(beforePages)
    expect(store.getState().browserAnnotationsByPageId).toEqual(beforeAnnotations)
    expect(store.getState().browserTabsByWorktree['browser-self']?.[0]?.id).toBe(destinationEntity)
  })

  it('rejects browser migration with missing canonical backing without writing', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('browser-wt', 'browser', {
        id: 'browser-tab',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        'browser-wt': store
          .getState()
          .unifiedTabsByWorktree['browser-wt']!.map((tab) => ({
            ...tab,
            catalogTabId: 'browser-tab',
            catalogEntityId: 'browser-entity',
            executionHostId: 'ssh:browser' as never
          }))
      }
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:browser',
          workspaceKey: 'browser-wt',
          catalogTabId: 'browser-tab',
          catalogEntityId: 'browser-entity'
        },
        'browser-tab'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('rejects occupied browser workspace destination without writing', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('browser-wt', 'browser', {
        id: 'browser-tab',
        activate: false,
        recordInteraction: false
      })
    const destination = makeSyncedTabIdentity(
      {
        executionHostId: 'ssh:browser',
        workspaceKey: 'browser-wt',
        catalogTabId: 'browser-entity'
      },
      'entity'
    )
    const sourceWorkspace = {
      id: 'browser-workspace',
      catalogEntityId: 'browser-entity',
      worktreeId: 'browser-wt',
      url: 'about:blank',
      title: 'Source',
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 1
    }
    const occupiedWorkspace = {
      ...sourceWorkspace,
      id: destination,
      catalogEntityId: 'other-entity',
      title: 'Occupied'
    }
    store.setState({
      unifiedTabsByWorktree: {
        'browser-wt': store
          .getState()
          .unifiedTabsByWorktree['browser-wt']!.map((tab) => ({
            ...tab,
            catalogTabId: 'browser-tab',
            catalogEntityId: 'browser-entity',
            executionHostId: 'ssh:browser' as never
          }))
      },
      browserTabsByWorktree: { 'browser-wt': [sourceWorkspace, occupiedWorkspace] },
      browserPagesByWorkspace: {}
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:browser',
          workspaceKey: 'browser-wt',
          catalogTabId: 'browser-tab',
          catalogEntityId: 'browser-entity'
        },
        'browser-tab'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('rejects an occupied destination from an unrelated canonical tuple without writing', () => {
    const { store, tuple } = browserMigrationFixture()
    const destination = makeSyncedTabIdentity(tuple, 'tab')
    const existing = {
      ...store.getState().unifiedTabsByWorktree[tuple.workspaceKey]![0]!,
      id: destination,
      catalogTabId: 'other-tab',
      executionHostId: tuple.executionHostId as never
    }
    store.setState({
      unifiedTabsByWorktree: {
        [tuple.workspaceKey]: [
          ...store.getState().unifiedTabsByWorktree[tuple.workspaceKey]!,
          existing
        ]
      }
    })
    const before = store.getState()
    let commits = 0
    const collisions: string[] = []
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      commits++
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (identity) => collisions.push(identity) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([destination])
    expect(commits).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it.each([
    ['editorDrafts', 'entity draft', 'tab draft'],
    ['markdownViewMode', 'entity-mode', 'tab-mode'],
    ['editorViewMode', 'entity-view', 'tab-view'],
    ['markdownFrontmatterVisible', true, false],
    ['markdownTableOfContentsVisible', false, true]
  ])(
    'rejects dual editor source keys converging into one destination (%s)',
    (mapName, entityValue, tabValue) => {
      const { store, tuple } = browserMigrationFixture(`editor-collision-${mapName}`)
      const sourceEntity = 'source-browser-entity'
      const sourceTab = 'source-tab'
      store.setState({ [mapName]: { [sourceEntity]: entityValue, [sourceTab]: tabValue } } as never)
      const destinationEntity = makeSyncedTabIdentity(
        { ...tuple, catalogTabId: 'canonical-entity' },
        'entity'
      )
      const before = store.getState()
      const collisions: string[] = []
      let writes = 0
      const original = store.setState
      store.setState = ((...args: Parameters<typeof original>) => {
        writes += 1
        return original(...args)
      }) as typeof original
      expect(
        migrateSyncedTabIdentity(
          store,
          { ...tuple, onCollision: (id) => collisions.push(id) },
          sourceTab
        )
      ).toBeNull()
      expect(collisions).toEqual([destinationEntity])
      expect(writes).toBe(0)
      expect(store.getState()).toBe(before)
    }
  )

  it('rejects missing source tab without writing', () => {
    const store = createTestStore()
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        { workspaceKey: 'missing', catalogTabId: 'tab', catalogEntityId: 'entity' },
        'source'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('reaches pending tab-focus page-pair collision after valid browser preflight', () => {
    const { store, tuple } = browserMigrationFixture('page-focus-branch')
    const pageId = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    const unrelated = {
      ...store.getState().unifiedTabsByWorktree['page-focus-branch']![0]!,
      id: 'other-host-tab',
      entityId: 'other-host-entity',
      executionHostId: 'ssh:other' as never
    }
    store.setState({
      unifiedTabsByWorktree: {
        'page-focus-branch': [
          ...store.getState().unifiedTabsByWorktree['page-focus-branch']!,
          unrelated
        ]
      },
      pendingAddressBarFocusByTabId: { 'live-page': true, [pageId]: true }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([pageId])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
    expect(store.getState().unifiedTabsByWorktree['page-focus-branch']?.[1]).toEqual(unrelated)
  })

  it('reaches closed snapshot recent-bucket convergence after duplicate guard', () => {
    const { store, tuple, sourceWorkspace, livePage, destinationEntity } = browserMigrationFixture(
      'closed-convergence-branch'
    )
    const historical = { ...sourceWorkspace, id: 'historical-convergence' }
    const historicalPage = {
      ...livePage,
      id: 'historical-page',
      catalogPageId: 'historical-page',
      workspaceId: historical.id
    }
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        'closed-convergence-branch': [{ workspace: historical, pages: [historicalPage] }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: {
        [sourceWorkspace.id]: [livePage],
        [historical.id]: [historicalPage]
      }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([destinationEntity])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('reaches recent-page duplicate collision after valid snapshot checks', () => {
    const { store, tuple, sourceWorkspace, livePage } =
      browserMigrationFixture('recent-duplicate-branch')
    const duplicatePages = [
      { ...livePage, id: 'recent-a', catalogPageId: 'same-recent' },
      { ...livePage, id: 'recent-b', catalogPageId: 'same-recent' }
    ]
    store.setState({
      recentlyClosedBrowserPagesByWorkspace: { [sourceWorkspace.id]: duplicatePages }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([
      makeSyncedTabIdentity({ ...tuple, catalogTabId: 'same-recent' }, 'page')
    ])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('rejects ambiguous raw identities across execution hosts', () => {
    const { store, tuple, sourceEntity, destinationEntity } =
      terminalMigrationFixture('shared-host')
    const otherHost = {
      ...store.getState().unifiedTabsByWorktree['shared-host']![0]!,
      id: 'source-tab',
      entityId: sourceEntity,
      executionHostId: 'ssh:other' as never
    }
    const otherBacking = { id: sourceEntity, worktreeId: 'shared-host', title: 'other-host' }
    const otherPty = { [sourceEntity]: ['other-pty'] }
    store.setState({
      unifiedTabsByWorktree: {
        'shared-host': [store.getState().unifiedTabsByWorktree['shared-host']![0]!, otherHost]
      },
      tabsByWorktree: {
        'shared-host': [{ id: sourceEntity, title: 'source' }, otherBacking] as never[]
      },
      ptyIdsByTabId: otherPty as never
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual(['source-tab'])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
    expect(store.getState().unifiedTabsByWorktree['shared-host']).toEqual(
      before.unifiedTabsByWorktree['shared-host']
    )
    expect(store.getState().tabsByWorktree['shared-host']).toEqual(
      before.tabsByWorktree['shared-host']
    )
    expect(store.getState().ptyIdsByTabId[sourceEntity]).toEqual(before.ptyIdsByTabId[sourceEntity])
    expect(destinationEntity).toBeDefined()
  })

  it('preserves same-entity terminal backing and pane maps on successful outer rekey', () => {
    const { store, tuple, destinationEntity } = terminalMigrationFixture('same-entity')
    store.setState({
      unifiedTabsByWorktree: {
        'same-entity': store
          .getState()
          .unifiedTabsByWorktree['same-entity']!.map((tab) => ({
            ...tab,
            entityId: destinationEntity
          }))
      }
    })
    const pane = `${destinationEntity}:leaf`
    const deepPane = `${destinationEntity}:leaf:child`
    const unrelatedPane = 'unrelated-entity:leaf'
    store.setState({
      tabsByWorktree: { 'same-entity': [{ id: destinationEntity, title: 'backing' }] as never[] },
      ptyIdsByTabId: { [destinationEntity]: ['pty'], unrelated: ['other-pty'] },
      terminalLayoutsByTabId: { [destinationEntity]: { root: pane, child: deepPane } } as never,
      runtimePaneTitlesByTabId: { [destinationEntity]: 'title', unrelated: 'other-title' },
      unreadTerminalTabs: { [destinationEntity]: true, unrelated: false },
      unreadTerminalPanes: { [pane]: true, [deepPane]: 'child', [unrelatedPane]: 'other' },
      acknowledgedAgentsByPaneKey: {
        [pane]: 'ack',
        [deepPane]: 'child-ack',
        [unrelatedPane]: 'other-ack'
      }
    } as never)
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(migrateSyncedTabIdentity(store, tuple, 'source-tab')).not.toBeNull()
    expect(writes).toBe(1)
    expect(store.getState().tabsByWorktree['same-entity']).toMatchObject([
      {
        id: destinationEntity,
        title: 'backing',
        catalogTabId: tuple.catalogTabId,
        catalogEntityId: tuple.catalogEntityId
      }
    ])
    expect(store.getState().ptyIdsByTabId[destinationEntity]).toEqual(['pty'])
    expect(store.getState().unreadTerminalPanes[pane]).toBe(true)
    expect(store.getState().unreadTerminalPanes[deepPane]).toBe('child')
    expect(store.getState().unreadTerminalPanes[unrelatedPane]).toBe('other')
    expect(store.getState().acknowledgedAgentsByPaneKey[deepPane]).toBe('child-ack')
    expect(store.getState().runtimePaneTitlesByTabId.unrelated).toBe('other-title')
  })

  it.each(['duplicate', 'destination'])(
    'rejects openFiles %s source/destination before write',
    (mode) => {
      const { store, tuple, sourceEntity, destinationEntity } = terminalMigrationFixture(
        `open-${mode}`
      )
      store.setState({
        openFiles:
          mode === 'duplicate'
            ? ([
                { id: sourceEntity, worktreeId: `open-${mode}` },
                { id: sourceEntity, worktreeId: `open-${mode}` }
              ] as never[])
            : ([
                { id: sourceEntity, worktreeId: `open-${mode}` },
                { id: destinationEntity, worktreeId: `open-${mode}` }
              ] as never[])
      })
      const before = store.getState()
      const collisions: string[] = []
      let writes = 0
      const original = store.setState
      store.setState = ((...args: Parameters<typeof original>) => {
        writes += 1
        return original(...args)
      }) as typeof original
      expect(
        migrateSyncedTabIdentity(
          store,
          { ...tuple, onCollision: (id) => collisions.push(id) },
          'source-tab'
        )
      ).toBeNull()
      expect(collisions).toEqual([destinationEntity])
      expect(writes).toBe(0)
      expect(store.getState()).toBe(before)
    }
  )

  it.each(['tabOrder', 'recentTabIds'])('rejects occupied group %s destination', (field) => {
    const { store, tuple } = terminalMigrationFixture(`group-${field}`)
    const destination = makeSyncedTabIdentity(tuple, 'tab')
    store.setState({
      groupsByWorktree: {
        [`group-${field}`]: [
          {
            id: 'group',
            tabOrder: field === 'tabOrder' ? ['source-tab', destination] : ['source-tab'],
            recentTabIds: field === 'recentTabIds' ? ['source-tab', destination] : []
          }
        ]
      }
    } as never)
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([destination])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it.each(['tabBarOrderByWorktree', 'pendingReconnectTabByWorktree'])(
    'rejects occupied terminal %s destination',
    (field) => {
      const { store, tuple, sourceEntity, destinationEntity } = terminalMigrationFixture(
        `terminal-list-${field}`
      )
      const values = [sourceEntity, destinationEntity]
      store.setState({ [field]: { [`terminal-list-${field}`]: values } } as never)
      const before = store.getState()
      const collisions: string[] = []
      let writes = 0
      const original = store.setState
      store.setState = ((...args: Parameters<typeof original>) => {
        writes += 1
        return original(...args)
      }) as typeof original
      expect(
        migrateSyncedTabIdentity(
          store,
          { ...tuple, onCollision: (id) => collisions.push(id) },
          'source-tab'
        )
      ).toBeNull()
      expect(collisions).toEqual([destinationEntity])
      expect(writes).toBe(0)
      expect(store.getState()).toBe(before)
    }
  )

  it('rejects source tab with missing terminal backing without writing', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'terminal', {
        id: 'source',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        wt: store
          .getState()
          .unifiedTabsByWorktree.wt!.map((tab) => ({
            ...tab,
            catalogTabId: 'tab',
            catalogEntityId: 'entity',
            executionHostId: 'ssh:h' as never
          }))
      }
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:h',
          workspaceKey: 'wt',
          catalogTabId: 'tab',
          catalogEntityId: 'entity'
        },
        'source'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('rejects wrong-host source without writing', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'terminal', {
        id: 'source',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        wt: store
          .getState()
          .unifiedTabsByWorktree.wt!.map((tab) => ({
            ...tab,
            catalogTabId: 'tab',
            catalogEntityId: 'entity',
            executionHostId: 'ssh:other' as never
          }))
      }
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:requested',
          workspaceKey: 'wt',
          catalogTabId: 'tab',
          catalogEntityId: 'entity'
        },
        'source'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('rejects occupied unrelated terminal destination without writing', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'terminal', {
        id: 'source',
        activate: false,
        recordInteraction: false
      })
    store.setState({
      unifiedTabsByWorktree: {
        wt: store
          .getState()
          .unifiedTabsByWorktree.wt!.map((tab) => ({
            ...tab,
            catalogTabId: 'tab',
            catalogEntityId: 'entity',
            entityId: 'source-entity',
            executionHostId: 'ssh:h' as never
          }))
      },
      tabsByWorktree: {
        wt: [
          {
            id: 'source-entity',
            ptyId: null,
            worktreeId: 'wt',
            title: 'x',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ] as never[]
      }
    })
    const destination = makeSyncedTabIdentity({
      executionHostId: 'ssh:h',
      workspaceKey: 'wt',
      catalogTabId: 'tab'
    })
    store.setState({
      unifiedTabsByWorktree: {
        wt: [
          ...store.getState().unifiedTabsByWorktree.wt!,
          {
            ...store.getState().unifiedTabsByWorktree.wt![0]!,
            id: destination,
            catalogTabId: 'other'
          }
        ]
      }
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:h',
          workspaceKey: 'wt',
          catalogTabId: 'tab',
          catalogEntityId: 'entity'
        },
        'source'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('rejects an occupied terminal backing destination after valid source preflight', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'terminal', {
        id: 'source-tab',
        activate: false,
        recordInteraction: false
      })
    const sourceTab = store.getState().unifiedTabsByWorktree.wt![0]!
    const sourceEntity = 'source-terminal-entity'
    const destinationEntity = makeSyncedTabIdentity(
      { executionHostId: 'ssh:h', workspaceKey: 'wt', catalogTabId: 'entity' },
      'entity'
    )
    store.setState({
      unifiedTabsByWorktree: {
        wt: [
          {
            ...sourceTab,
            id: 'source-tab',
            entityId: sourceEntity,
            catalogTabId: 'tab',
            catalogEntityId: 'entity',
            executionHostId: 'ssh:h' as never
          }
        ]
      },
      tabsByWorktree: {
        wt: [
          {
            id: sourceEntity,
            ptyId: null,
            worktreeId: 'wt',
            title: 'source',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          },
          {
            id: destinationEntity,
            ptyId: null,
            worktreeId: 'wt',
            title: 'unrelated',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 1
          }
        ] as never[]
      }
    })
    let commits = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      commits++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        {
          executionHostId: 'ssh:h',
          workspaceKey: 'wt',
          catalogTabId: 'tab',
          catalogEntityId: 'entity'
        },
        'source-tab'
      )
    ).toBeNull()
    expect(commits).toBe(0)
  })

  it('migrates four typed pane maps and preserves nested history/subagents', () => {
    const store = createTestStore()
    const sourceEntity = 'source-terminal-entity'
    const destinationEntity = makeSyncedTabIdentity(
      { executionHostId: 'ssh:typed', workspaceKey: 'typed-wt', catalogTabId: 'canonical-entity' },
      'entity'
    )
    store
      .getState()
      .createUnifiedTab('typed-wt', 'terminal', {
        id: 'source-tab',
        activate: false,
        recordInteraction: false
      })
    const history = [{ state: 'done' }]
    const subagents = [{ id: 'child' }]
    const status = {
      paneKey: `${sourceEntity}:leaf`,
      tabId: sourceEntity,
      stateHistory: history,
      subagents,
      orchestration: { parentPaneKey: `${sourceEntity}:parent` }
    } as never
    store.setState({
      unifiedTabsByWorktree: {
        'typed-wt': store
          .getState()
          .unifiedTabsByWorktree['typed-wt']!.map((tab) => ({
            ...tab,
            id: 'source-tab',
            entityId: sourceEntity,
            catalogTabId: 'canonical-tab',
            catalogEntityId: 'canonical-entity',
            executionHostId: 'ssh:typed' as never
          }))
      },
      tabsByWorktree: {
        'typed-wt': [
          {
            id: sourceEntity,
            ptyId: null,
            worktreeId: 'typed-wt',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ] as never[]
      },
      activeFileId: sourceEntity,
      activeFileIdByWorktree: { 'typed-wt': sourceEntity, 'other-wt': sourceEntity },
      openFiles: [
        { id: sourceEntity, worktreeId: 'typed-wt' },
        { id: sourceEntity, worktreeId: 'other-wt', filePath: '/other' }
      ] as never[],
      agentStatusByPaneKey: { [`${sourceEntity}:leaf`]: status },
      runtimeAgentOrchestrationByPaneKey: {
        [`${sourceEntity}:leaf`]: { parentPaneKey: `${sourceEntity}:parent` } as never
      },
      retainedAgentsByPaneKey: {
        [`${sourceEntity}:leaf`]: { entry: status, tab: { id: sourceEntity } as never } as never
      },
      agentLaunchConfigByPaneKey: {
        [`${sourceEntity}:leaf`]: {
          launchConfig: {},
          registeredAt: 1,
          identity: { tabId: sourceEntity }
        } as never
      }
    })
    const migrated = migrateSyncedTabIdentity(
      store,
      {
        executionHostId: 'ssh:typed',
        workspaceKey: 'typed-wt',
        catalogTabId: 'canonical-tab',
        catalogEntityId: 'canonical-entity'
      },
      'source-tab'
    )
    expect(migrated).not.toBeNull()
    const state = store.getState()
    const key = `${destinationEntity}:leaf`
    expect(state.agentStatusByPaneKey[key]?.paneKey).toBe(key)
    expect(state.agentStatusByPaneKey[key]?.tabId).toBe(destinationEntity)
    expect(state.agentStatusByPaneKey[key]?.orchestration?.parentPaneKey).toBe(
      `${destinationEntity}:parent`
    )
    expect(state.agentStatusByPaneKey[key]?.stateHistory).toEqual(history)
    expect(state.agentStatusByPaneKey[key]?.subagents).toEqual(subagents)
    expect(state.runtimeAgentOrchestrationByPaneKey[key]?.parentPaneKey).toBe(
      `${destinationEntity}:parent`
    )
    expect(state.retainedAgentsByPaneKey[key]?.entry.tabId).toBe(destinationEntity)
    expect(state.retainedAgentsByPaneKey[key]?.entry.paneKey).toBe(key)
    expect(state.retainedAgentsByPaneKey[key]?.entry.orchestration?.parentPaneKey).toBe(
      `${destinationEntity}:parent`
    )
    expect(state.retainedAgentsByPaneKey[key]?.entry.stateHistory).toEqual(history)
    expect(state.retainedAgentsByPaneKey[key]?.entry.subagents).toEqual(subagents)
    expect(state.retainedAgentsByPaneKey[key]?.tab.id).toBe(destinationEntity)
    expect(state.agentLaunchConfigByPaneKey[key]?.identity.tabId).toBe(destinationEntity)
    expect(state.agentStatusByPaneKey[`${sourceEntity}:leaf`]).toBeUndefined()
    expect(state.runtimeAgentOrchestrationByPaneKey[`${sourceEntity}:leaf`]).toBeUndefined()
    expect(state.retainedAgentsByPaneKey[`${sourceEntity}:leaf`]).toBeUndefined()
    expect(state.agentLaunchConfigByPaneKey[`${sourceEntity}:leaf`]).toBeUndefined()
    expect(state.activeFileId).toBe(destinationEntity)
    expect(state.activeFileIdByWorktree['typed-wt']).toBe(destinationEntity)
    expect(state.activeFileIdByWorktree['other-wt']).toBe(sourceEntity)
    expect(state.openFiles.find((file) => file.worktreeId === 'typed-wt')?.id).toBe(
      destinationEntity
    )
    expect(state.openFiles.find((file) => file.worktreeId === 'other-wt')).toEqual({
      id: sourceEntity,
      worktreeId: 'other-wt',
      filePath: '/other'
    })
  })

  it('preserves nonterminal terminal backing state', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'editor', { id: 'source', activate: false, recordInteraction: false })
    store.setState({
      unifiedTabsByWorktree: {
        wt: store
          .getState()
          .unifiedTabsByWorktree.wt!.map((tab) => ({
            ...tab,
            id: 'source',
            entityId: 'shared-entity',
            catalogTabId: 'source',
            catalogEntityId: 'entity'
          }))
      }
    })
    const tabs = [{ id: 'shared-entity', worktreeId: 'wt' }] as never[]
    store.setState({
      tabsByWorktree: { wt: tabs },
      pendingReconnectTabByWorktree: { wt: ['shared-entity'] },
      ptyIdsByTabId: { 'shared-entity': ['pty'] },
      terminalLayoutsByTabId: { 'shared-entity': { root: null } } as never,
      activeTabId: 'shared-entity',
      activeTabIdByWorktree: { wt: 'shared-entity' },
      tabBarOrderByWorktree: { wt: ['shared-entity'] },
      unreadTerminalTabs: { 'shared-entity': true },
      unreadTerminalPanes: { 'shared-entity:leaf': true },
      agentStatusByPaneKey: { 'shared-entity:leaf': {} as never }
    })
    const before = store.getState()
    const result = migrateSyncedTabIdentity(
      store,
      { workspaceKey: 'wt', catalogTabId: 'source', catalogEntityId: 'entity' },
      'source'
    )
    const after = store.getState()
    expect(result).not.toBeNull()
    expect(after.tabsByWorktree).toEqual(before.tabsByWorktree)
    expect(after.pendingReconnectTabByWorktree).toEqual(before.pendingReconnectTabByWorktree)
    expect(after.ptyIdsByTabId).toEqual(before.ptyIdsByTabId)
    expect(after.terminalLayoutsByTabId).toEqual(before.terminalLayoutsByTabId)
    expect(after.activeTabId).toBe(before.activeTabId)
    expect(after.activeTabIdByWorktree).toEqual(before.activeTabIdByWorktree)
    expect(after.tabBarOrderByWorktree).toEqual(before.tabBarOrderByWorktree)
    expect(after.unreadTerminalTabs).toEqual(before.unreadTerminalTabs)
    expect(after.unreadTerminalPanes).toEqual(before.unreadTerminalPanes)
    expect(after.agentStatusByPaneKey).toEqual(before.agentStatusByPaneKey)
  })

  it('keeps active browser relation on joined workspace identity', () => {
    const store = createTestStore()
    store
      .getState()
      .createUnifiedTab('wt', 'browser', { id: 'tab', activate: false, recordInteraction: false })
    store.setState({
      unifiedTabsByWorktree: {
        wt: store
          .getState()
          .unifiedTabsByWorktree.wt!.map((tab) => ({
            ...tab,
            catalogTabId: 'tab',
            catalogEntityId: 'entity',
            executionHostId: 'ssh:h' as never
          }))
      },
      browserTabsByWorktree: {
        wt: [{ id: 'joined', catalogEntityId: 'entity', worktreeId: 'wt' }] as never[]
      },
      browserPagesByWorkspace: { joined: [] },
      activeBrowserTabId: 'joined',
      activeBrowserTabIdByWorktree: { wt: 'joined', other: 'joined' }
    })
    migrateSyncedTabIdentity(
      store,
      {
        executionHostId: 'ssh:h',
        workspaceKey: 'wt',
        catalogTabId: 'tab',
        catalogEntityId: 'entity'
      },
      'tab'
    )
    const destination = makeSyncedTabIdentity(
      { executionHostId: 'ssh:h', workspaceKey: 'wt', catalogTabId: 'entity' },
      'entity'
    )
    expect(store.getState().activeBrowserTabId).toBe(destination)
    expect(store.getState().activeBrowserTabIdByWorktree.wt).toBe(destination)
    expect(store.getState().activeBrowserTabIdByWorktree.other).toBe('joined')
  })

  it('remaps closed snapshot-owned pages independently', () => {
    const { store, sourceWorkspace, tuple, destinationEntity } = browserMigrationFixture('closed')
    const livePage = store.getState().browserPagesByWorkspace[sourceWorkspace.id]![0]!
    const closedPage = {
      id: 'closed-only',
      catalogPageId: 'closed-only',
      workspaceId: sourceWorkspace.id,
      worktreeId: 'closed',
      url: 'about:blank',
      title: 'Closed',
      loading: false,
      faviconUrl: null,
      canGoBack: false,
      canGoForward: false,
      loadError: null,
      createdAt: 2
    }
    const closedWorkspace = {
      ...sourceWorkspace,
      id: 'closed-workspace',
      pageIds: ['closed-only'],
      activePageId: 'closed-only'
    }
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        closed: [{ workspace: closedWorkspace, pages: [closedPage] }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: { 'closed-workspace': [closedPage] }
    })
    expect(migrateSyncedTabIdentity(store, tuple, 'source-tab')).toBeTruthy()
    expect(store.getState().recentlyClosedBrowserTabsByWorktree.closed[0]?.workspace.id).toBe(
      destinationEntity
    )
    expect(store.getState().recentlyClosedBrowserTabsByWorktree.closed[0]?.pages[0]?.id).toBe(
      makeSyncedTabIdentity({ ...tuple, catalogTabId: 'closed-only' }, 'page')
    )
    expect(store.getState().recentlyClosedBrowserPagesByWorkspace[destinationEntity]?.[0]?.id).toBe(
      makeSyncedTabIdentity({ ...tuple, catalogTabId: 'closed-only' }, 'page')
    )
    expect(sourceWorkspace.id).not.toBe(closedWorkspace.id)
    expect(
      store.getState().recentlyClosedBrowserPagesByWorkspace['closed-workspace']
    ).toBeUndefined()
    expect(
      store.getState().recentlyClosedBrowserTabsByWorktree.closed[0]?.pages[0]?.workspaceId
    ).toBe(destinationEntity)
    expect(store.getState().recentlyClosedBrowserTabsByWorktree.closed[0]?.pages[0]?.id).not.toBe(
      livePage.id
    )
  })

  it('migrates live history when canonical historical snapshot has no recent-page key', () => {
    const { store, sourceWorkspace, tuple, destinationEntity, livePage } =
      browserMigrationFixture('live-history')
    const historical = { ...sourceWorkspace, id: 'historical-workspace' }
    const historicalPage = {
      ...livePage,
      id: 'historical-only',
      catalogPageId: 'historical-only',
      workspaceId: historical.id
    }
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        'live-history': [{ workspace: historical, pages: [historicalPage] }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: { [sourceWorkspace.id]: [livePage] }
    })
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    expect(migrateSyncedTabIdentity(store, tuple, 'source-tab')).not.toBeNull()
    expect(writes).toBe(1)
    const livePageId = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    const historicalPageId = makeSyncedTabIdentity(
      { ...tuple, catalogTabId: 'historical-only' },
      'page'
    )
    expect(
      store.getState().recentlyClosedBrowserPagesByWorkspace[destinationEntity]?.[0]
    ).toMatchObject({ id: livePageId, workspaceId: destinationEntity })
    expect(store.getState().recentlyClosedBrowserTabsByWorktree['live-history']?.[0]).toMatchObject(
      {
        workspace: { id: destinationEntity },
        pages: [{ id: historicalPageId, workspaceId: destinationEntity }]
      }
    )
  })

  it('rejects converging live and historical recent-page histories atomically', () => {
    const { store, sourceWorkspace, tuple, destinationEntity, livePage } =
      browserMigrationFixture('converging-history')
    const historical = { ...sourceWorkspace, id: 'historical-workspace' }
    const historicalPage = {
      ...livePage,
      id: 'historical-only',
      catalogPageId: 'historical-only',
      workspaceId: historical.id
    }
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        'converging-history': [{ workspace: historical, pages: [historicalPage] }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: {
        [sourceWorkspace.id]: [livePage],
        [historical.id]: [historicalPage]
      }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([destinationEntity])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('reports the first repeated hashed page in a later closed snapshot entry', () => {
    const { store, sourceWorkspace, tuple } = browserMigrationFixture('repeated-page-order')
    const historical = { ...sourceWorkspace, id: 'historical-repeated' }
    const pages = [
      { id: 'raw-first', catalogPageId: 'first-page', workspaceId: historical.id },
      { id: 'raw-second', catalogPageId: 'repeated-page', workspaceId: historical.id },
      { id: 'raw-third', catalogPageId: 'repeated-page', workspaceId: historical.id }
    ]
    const otherSnapshot = {
      workspace: { ...historical, id: 'other-history' },
      pages: pages.map((page) => ({ ...page, workspaceId: 'other-history' }))
    }
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        'repeated-page-order': [{ workspace: historical, pages }] as never[],
        other: [otherSnapshot] as never[]
      }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const original = store.setState
    store.setState = ((...args: Parameters<typeof original>) => {
      writes += 1
      return original(...args)
    }) as typeof original
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    const first = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'first-page' }, 'page')
    const repeated = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'repeated-page' }, 'page')
    expect(collisions).toEqual([repeated])
    expect(repeated).not.toBe(first)
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
    expect(store.getState().recentlyClosedBrowserTabsByWorktree.other).toEqual([otherSnapshot])
  })

  it('rejects occupied destination browser page arrays', () => {
    const { store, tuple, destinationEntity } = browserMigrationFixture('pages')
    let writes = 0
    const set = store.setState
    store.setState({
      browserPagesByWorkspace: {
        ...store.getState().browserPagesByWorkspace,
        [destinationEntity]: [
          {
            id: 'occupied-page',
            workspaceId: destinationEntity,
            worktreeId: 'pages',
            url: 'about:blank',
            title: 'Occupied',
            loading: false,
            faviconUrl: null,
            canGoBack: false,
            canGoForward: false,
            loadError: null,
            createdAt: 9
          }
        ] as never[]
      }
    })
    const before = store.getState()
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    const collisions: string[] = []
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([destinationEntity])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('rejects occupied destination page-map keys', () => {
    const { store, tuple } = browserMigrationFixture('maps')
    let writes = 0
    const set = store.setState
    const pageId = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    store.setState({
      browserCertificateFailuresByPageId: {
        'live-page': { browserPageId: 'live-page' } as never,
        [pageId]: { browserPageId: pageId } as never
      }
    })
    const before = store.getState()
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    const collisions: string[] = []
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([pageId])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it.each([
    'browserCertificateFailuresByPageId',
    'browserAnnotationsByPageId',
    'remoteBrowserPageHandlesByPageId',
    'pendingAddressBarFocusByPageId',
    'pendingAddressBarFocusByTabId'
  ] as const)('rejects occupied %s destination before writing', (mapName) => {
    const { store, tuple, destinationEntity, sourceWorkspace } = browserMigrationFixture(
      `collision-${mapName}`
    )
    const key =
      mapName === 'pendingAddressBarFocusByTabId'
        ? destinationEntity
        : makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    const sourceKey = mapName === 'pendingAddressBarFocusByTabId' ? sourceWorkspace.id : 'live-page'
    const sourceValue =
      mapName === 'browserCertificateFailuresByPageId'
        ? { browserPageId: sourceKey }
        : mapName === 'remoteBrowserPageHandlesByPageId'
          ? { environmentId: 'env', remotePageId: sourceKey }
          : mapName === 'browserAnnotationsByPageId'
            ? [{ id: 'source', browserPageId: sourceKey }]
            : true
    const destinationValue =
      mapName === 'browserCertificateFailuresByPageId'
        ? { browserPageId: key }
        : mapName === 'remoteBrowserPageHandlesByPageId'
          ? { environmentId: 'env', remotePageId: key }
          : mapName === 'browserAnnotationsByPageId'
            ? [{ id: 'destination', browserPageId: key }]
            : true
    store.setState({ [mapName]: { [sourceKey]: sourceValue, [key]: destinationValue } } as never)
    const before = store.getState()
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    const collisions: string[] = []
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([key])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('rejects annotation destination membership even when destination array is empty', () => {
    const { store, tuple } = browserMigrationFixture('annotation-membership')
    const pageId = makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    store.setState({
      browserAnnotationsByPageId: {
        'live-page': [{ id: 'source', browserPageId: 'live-page' }],
        [pageId]: []
      }
    } as never)
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([pageId])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('rejects duplicate live canonical pages before writing', () => {
    const { store, tuple, sourceWorkspace, livePage, destinationEntity } =
      browserMigrationFixture('duplicate-live')
    store.setState({
      browserPagesByWorkspace: {
        [sourceWorkspace.id]: [
          livePage,
          { ...livePage, id: 'other-live', catalogPageId: livePage.catalogPageId }
        ]
      }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([
      makeSyncedTabIdentity({ ...tuple, catalogTabId: 'live-page' }, 'page')
    ])
    expect(destinationEntity).toBeTruthy()
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('rejects duplicate canonical pages in historical and recent sources', () => {
    const { store, tuple, sourceWorkspace, livePage } = browserMigrationFixture('duplicate-history')
    const historical = { ...sourceWorkspace, id: 'historical-workspace' }
    const pages = [
      {
        ...livePage,
        id: 'historical-a',
        catalogPageId: 'same-history',
        workspaceId: historical.id
      },
      { ...livePage, id: 'historical-b', catalogPageId: 'same-history', workspaceId: historical.id }
    ]
    store.setState({
      recentlyClosedBrowserTabsByWorktree: {
        'duplicate-history': [{ workspace: historical, pages }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: { [historical.id]: pages }
    })
    const before = store.getState()
    const collisions: string[] = []
    let writes = 0
    const set = store.setState
    store.setState = ((...args: Parameters<typeof set>) => {
      writes++
      return set(...args)
    }) as typeof set
    expect(
      migrateSyncedTabIdentity(
        store,
        { ...tuple, onCollision: (id) => collisions.push(id) },
        'source-tab'
      )
    ).toBeNull()
    expect(collisions).toEqual([
      makeSyncedTabIdentity({ ...tuple, catalogTabId: 'same-history' }, 'page')
    ])
    expect(writes).toBe(0)
    expect(store.getState()).toBe(before)
  })

  it('preserves unrelated host and workspace identities', () => {
    const { store, tuple, sourceWorkspace } = browserMigrationFixture('other')
    const unrelated = {
      ...sourceWorkspace,
      id: 'other-raw-workspace',
      worktreeId: 'other-worktree'
    }
    const unrelatedPage = {
      ...store.getState().browserPagesByWorkspace[sourceWorkspace.id]![0]!,
      workspaceId: unrelated.id,
      worktreeId: 'other-worktree'
    }
    store.setState({
      browserTabsByWorktree: {
        ...store.getState().browserTabsByWorktree,
        'other-worktree': [unrelated]
      },
      browserPagesByWorkspace: {
        ...store.getState().browserPagesByWorkspace,
        [unrelated.id]: [unrelatedPage]
      },
      recentlyClosedBrowserTabsByWorktree: {
        'other-worktree': [{ workspace: unrelated, pages: [unrelatedPage] }] as never[]
      },
      recentlyClosedBrowserPagesByWorkspace: { [unrelated.id]: [unrelatedPage] }
    })
    const before = {
      tabs: store.getState().browserTabsByWorktree['other-worktree'],
      pages: store.getState().browserPagesByWorkspace[unrelated.id],
      recentTabs: store.getState().recentlyClosedBrowserTabsByWorktree['other-worktree'],
      recentPages: store.getState().recentlyClosedBrowserPagesByWorkspace[unrelated.id]
    }
    migrateSyncedTabIdentity(store, tuple, 'source-tab')
    expect(store.getState().browserTabsByWorktree['other-worktree']).toEqual(before.tabs)
    expect(store.getState().browserPagesByWorkspace[unrelated.id]).toEqual(before.pages)
    expect(store.getState().recentlyClosedBrowserTabsByWorktree['other-worktree']).toEqual(
      before.recentTabs
    )
    expect(store.getState().recentlyClosedBrowserPagesByWorkspace[unrelated.id]).toEqual(
      before.recentPages
    )
  })

  it('planner rejects late occupied destinations without a patch', () => {
    const { store, tuple, destinationEntity } = terminalMigrationFixture('planner-collision')
    const destinationTab = {
      ...store.getState().unifiedTabsByWorktree['planner-collision']![0]!,
      id: makeSyncedTabIdentity(tuple, 'tab'),
      entityId: destinationEntity
    }
    store.setState({
      unifiedTabsByWorktree: {
        'planner-collision': [
          store.getState().unifiedTabsByWorktree['planner-collision']![0]!,
          destinationTab
        ]
      }
    })
    const before = store.getState()
    expect(planSyncedTabIdentityMigration(before, tuple, 'source-tab')).toBeNull()
    expect(store.getState()).toBe(before)
  })
})
