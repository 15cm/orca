// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { WorktreePrimaryContextMenuItem } from './WorktreePrimaryContextMenuItem'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const worktree = {
  id: 'repo::/main',
  repoId: 'repo',
  projectId: 'p',
  hostId: 'local' as const,
  instanceId: 'i',
  peerFingerprint: 'peer',
  path: '/repo',
  displayName: 'Main',
  isMainWorktree: true,
  isArchived: false,
  isBare: false,
  prunable: false
}
const repo = { id: 'repo', path: '/repo', displayName: 'Repo', badgeColor: '#000', addedAt: 1 }
const project = {
  id: 'p',
  displayName: 'P',
  badgeColor: '#000',
  sourceRepoIds: ['repo'],
  createdAt: 1,
  updatedAt: 1
}

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('WorktreePrimaryContextMenuItem', () => {
  it('submits once while pending and reports thrown errors', async () => {
    let rejectAction!: (error: Error) => void
    const action = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectAction = reject
        })
    )
    useAppStore.setState({
      projects: [project],
      worktreesByRepo: { repo: [worktree] },
      setProjectPrimaryWorkspace: action
    } as never)
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorktreePrimaryContextMenuItem
            worktree={worktree as never}
            repo={repo as never}
            disabled={false}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const item = screen.getByRole('menuitem')
    fireEvent.click(item)
    fireEvent.click(item)
    expect(action).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(item.getAttribute('aria-disabled')).toBe('true'))
    rejectAction(new Error('offline'))
    await waitFor(() => expect(item.getAttribute('aria-disabled')).not.toBe('true'))
    const { toast } = await import('sonner')
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('disables exact current identity and permits reassignment without changing active workspace', () => {
    const selected = {
      worktreeId: worktree.id,
      instanceId: 'i',
      hostId: 'local' as const,
      path: '/repo',
      peerFingerprint: 'peer',
      authorityFingerprint: 'authority'
    }
    const action = vi.fn().mockResolvedValue({ project })
    useAppStore.setState({
      projects: [{ ...project, primaryWorkspace: selected }],
      worktreesByRepo: { repo: [worktree] },
      activeWorktreeId: 'other',
      setProjectPrimaryWorkspace: action
    } as never)
    const { rerender } = render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorktreePrimaryContextMenuItem
            worktree={worktree as never}
            repo={repo as never}
            disabled={false}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(screen.getByRole('menuitem').getAttribute('aria-disabled')).toBe('true')
    const replacement = { ...worktree, instanceId: 'new' }
    useAppStore.setState({
      projects: [project],
      worktreesByRepo: { repo: [replacement] },
      activeWorktreeId: 'other',
      setProjectPrimaryWorkspace: action
    } as never)
    rerender(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorktreePrimaryContextMenuItem
            worktree={replacement as never}
            repo={repo as never}
            disabled={false}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    fireEvent.click(screen.getByRole('menuitem'))
    expect(action).toHaveBeenCalledWith('p', replacement.id, 'local')
    expect(useAppStore.getState().activeWorktreeId).toBe('other')
  })
})
