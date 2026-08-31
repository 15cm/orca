import { describe, expect, it } from 'vitest'
import { parseWorkspaceSession } from './workspace-session-schema'

describe('parseWorkspaceSession terminal fields', () => {
  type SessionRow = Record<string, unknown>
  type SessionShape = Record<string, unknown>
  type SessionRows = Record<string, SessionRow[]>
  it('round-trips catalog entry identities byte-for-byte through restart JSON', () => {
    const session = {
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: null,
      tabsByWorktree: { wt: [] },
      terminalLayoutsByTabId: {},
      sharedTabCatalog: {
        partitions: {
          p: {
            revision: 4,
            tabs: [
              {
                tabId: '  tab  ',
                catalogTabId: '  catalog-tab  ',
                contentType: 'browser',
                metadata: {
                  entityId: 'internal',
                  catalogEntityId: '  entity  ',
                  label: 'Browser',
                  customLabel: null,
                  color: null
                },
                backingState: {
                  kind: 'browser',
                  browserWorkspaceId: 'internal-workspace',
                  catalogEntityId: '  entity  ',
                  pages: ['stc_page'],
                  catalogPageIds: ['  page  ']
                }
              }
            ],
            tombstones: []
          }
        }
      }
    }
    const parsed = parseWorkspaceSession(JSON.parse(JSON.stringify(session)))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.sharedTabCatalog?.partitions.p.tabs[0]).toMatchObject({
        catalogTabId: '  catalog-tab  ',
        metadata: { catalogEntityId: '  entity  ' },
        backingState: { catalogEntityId: '  entity  ', catalogPageIds: ['  page  '] }
      })
    }
  })
  it('round-trips optional identities and salvages malformed identity fields', () => {
    const session = {
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt: [
          {
            id: 'tab1',
            catalogTabId: '  catalog-tab  ',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      terminalLayoutsByTabId: {},
      openFilesByWorktree: {
        wt: [
          {
            catalogEntityId: '  entity  ',
            filePath: '/a',
            relativePath: 'a',
            worktreeId: 'wt',
            language: 'txt'
          }
        ]
      },
      browserTabsByWorktree: {
        wt: [
          {
            id: 'browser',
            catalogEntityId: '  entity  ',
            worktreeId: 'wt',
            url: 'about:blank',
            title: '',
            loading: false,
            faviconUrl: null,
            canGoBack: false,
            canGoForward: false,
            loadError: null,
            createdAt: 0,
            pageIds: ['page'],
            activePageId: 'page'
          }
        ]
      },
      browserPagesByWorkspace: {
        browser: [
          {
            id: 'page',
            catalogPageId: '  catalog-page  ',
            workspaceId: 'browser',
            worktreeId: 'wt',
            url: 'about:blank',
            title: '',
            loading: false,
            faviconUrl: null,
            canGoBack: false,
            canGoForward: false,
            loadError: null,
            createdAt: 0
          }
        ]
      }
    }
    const parsed = parseWorkspaceSession(session)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.tabsByWorktree.wt[0]?.catalogTabId).toBe('  catalog-tab  ')
      expect(parsed.value.openFilesByWorktree?.wt[0]?.catalogEntityId).toBe('  entity  ')
      expect(parsed.value.browserTabsByWorktree?.wt[0]?.catalogEntityId).toBe('  entity  ')
      expect(parsed.value.browserPagesByWorkspace?.browser[0]?.catalogPageId).toBe(
        '  catalog-page  '
      )
    }
    const malformed = parseWorkspaceSession({
      ...session,
      tabsByWorktree: { wt: [{ ...session.tabsByWorktree.wt[0], catalogTabId: 42 }] }
    })
    expect(malformed.ok).toBe(true)
    if (malformed.ok) {
      expect(malformed.value.tabsByWorktree.wt[0]?.catalogTabId).toBeUndefined()
    }
    const blank = parseWorkspaceSession({
      ...session,
      tabsByWorktree: { wt: [{ ...session.tabsByWorktree.wt[0], catalogTabId: '   ' }] }
    })
    expect(blank.ok).toBe(true)
    if (blank.ok) {
      expect(blank.value.tabsByWorktree.wt[0]?.catalogTabId).toBeUndefined()
    }
  })

  it('retains unified identity fields through repeated JSON round trips', () => {
    const session = {
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab',
      tabsByWorktree: { wt: [] },
      terminalLayoutsByTabId: {},
      unifiedTabs: {
        wt: [
          {
            id: 'internal-tab',
            entityId: 'internal-entity',
            catalogTabId: '  catalog-tab  ',
            catalogEntityId: '  catalog-entity  ',
            groupId: 'group',
            worktreeId: 'wt',
            contentType: 'editor',
            label: 'File',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      }
    }
    const first = parseWorkspaceSession(JSON.parse(JSON.stringify(session)))
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const second = parseWorkspaceSession(JSON.parse(JSON.stringify(first.value)))
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.value.unifiedTabs?.wt[0]).toMatchObject({
        catalogTabId: '  catalog-tab  ',
        catalogEntityId: '  catalog-entity  '
      })
    }
    const malformed = parseWorkspaceSession({
      ...session,
      unifiedTabs: { wt: [{ ...session.unifiedTabs.wt[0], catalogTabId: 42, catalogEntityId: {} }] }
    })
    expect(malformed.ok).toBe(true)
    if (malformed.ok) {
      expect(malformed.value.unifiedTabs?.wt[0]?.catalogTabId).toBeUndefined()
    }
  })

  it.each<
    [string, (session: SessionShape, value: unknown) => void, (parsed: SessionShape) => unknown]
  >([
    [
      'terminal catalogTabId',
      (s, v) => {
        ;(s.tabsByWorktree as SessionRows).wt![0]!.catalogTabId = v
      },
      (p) => (p.tabsByWorktree as SessionRows).wt![0]!.catalogTabId
    ],
    [
      'unified catalogTabId',
      (s, v) => {
        ;(s.unifiedTabs as SessionRows).wt![0]!.catalogTabId = v
      },
      (p) => (p.unifiedTabs as SessionRows).wt![0]!.catalogTabId
    ],
    [
      'unified catalogEntityId',
      (s, v) => {
        ;(s.unifiedTabs as SessionRows).wt![0]!.catalogEntityId = v
      },
      (p) => (p.unifiedTabs as SessionRows).wt![0]!.catalogEntityId
    ],
    [
      'editor catalogEntityId',
      (s, v) => {
        ;(s.openFilesByWorktree as SessionRows).wt![0]!.catalogEntityId = v
      },
      (p) => (p.openFilesByWorktree as SessionRows).wt![0]!.catalogEntityId
    ],
    [
      'browser workspace catalogEntityId',
      (s, v) => {
        ;(s.browserTabsByWorktree as SessionRows).wt![0]!.catalogEntityId = v
      },
      (p) => (p.browserTabsByWorktree as SessionRows).wt![0]!.catalogEntityId
    ],
    [
      'browser page catalogPageId',
      (s, v) => {
        ;(s.browserPagesByWorkspace as SessionRows).browser![0]!.catalogPageId = v
      },
      (p) => (p.browserPagesByWorkspace as SessionRows).browser![0]!.catalogPageId
    ]
  ])(
    'salvages invalid %s identity without affecting accepted fields',
    (_name, setValue, readValue) => {
      const session: SessionShape = {
        activeRepoId: null,
        activeWorktreeId: 'wt',
        activeTabId: 'tab1',
        terminalLayoutsByTabId: {},
        tabsByWorktree: {
          wt: [
            {
              id: 'tab1',
              catalogTabId: '  terminal  ',
              ptyId: null,
              worktreeId: 'wt',
              title: 'Terminal',
              customTitle: null,
              color: null,
              sortOrder: 0,
              createdAt: 0
            }
          ]
        },
        unifiedTabs: {
          wt: [
            {
              id: 'tab',
              entityId: 'entity',
              catalogTabId: '  tab  ',
              catalogEntityId: '  entity  ',
              groupId: 'group',
              worktreeId: 'wt',
              contentType: 'editor',
              label: 'Editor',
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 0
            }
          ]
        },
        openFilesByWorktree: {
          wt: [
            {
              catalogEntityId: '  file-entity  ',
              filePath: '/a',
              relativePath: 'a',
              worktreeId: 'wt',
              language: 'txt'
            }
          ]
        },
        browserTabsByWorktree: {
          wt: [
            {
              id: 'browser',
              catalogEntityId: '  browser-entity  ',
              worktreeId: 'wt',
              url: 'about:blank',
              title: '',
              loading: false,
              faviconUrl: null,
              canGoBack: false,
              canGoForward: false,
              loadError: null,
              createdAt: 0,
              pageIds: ['page'],
              activePageId: 'page'
            }
          ]
        },
        browserPagesByWorkspace: {
          browser: [
            {
              id: 'page',
              catalogPageId: '  page  ',
              workspaceId: 'browser',
              worktreeId: 'wt',
              url: 'about:blank',
              title: '',
              loading: false,
              faviconUrl: null,
              canGoBack: false,
              canGoForward: false,
              loadError: null,
              createdAt: 0
            }
          ]
        }
      }
      for (const invalid of [42, '   ', 'x'.repeat(513)]) {
        const candidate = structuredClone(session)
        setValue(candidate, invalid)
        const parsed = parseWorkspaceSession(candidate)
        expect(parsed.ok).toBe(true)
        if (parsed.ok) {
          expect(readValue(parsed.value as SessionShape)).toBeUndefined()
        }
      }
    }
  )

  it('preserves terminal startup cwd while accepting older omitted fields', () => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt: [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 1',
            defaultTitle: 'Terminal 1',
            startupCwd: '/repo/packages/app',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          },
          {
            id: 'tab2',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 2',
            customTitle: null,
            color: null,
            sortOrder: 1,
            createdAt: 1
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tabsByWorktree.wt[0].startupCwd).toBe('/repo/packages/app')
      expect(result.value.tabsByWorktree.wt[1].startupCwd).toBeUndefined()
    }
  })

  it('drops a tab with an empty startup cwd instead of failing the session', () => {
    const result = parseWorkspaceSession({
      activeRepoId: null,
      activeWorktreeId: 'wt',
      activeTabId: 'tab1',
      tabsByWorktree: {
        wt: [
          {
            id: 'tab1',
            ptyId: null,
            worktreeId: 'wt',
            title: 'Terminal 1',
            defaultTitle: 'Terminal 1',
            startupCwd: '',
            customTitle: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        ]
      },
      terminalLayoutsByTabId: {}
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tabsByWorktree.wt).toEqual([])
    }
  })
})
