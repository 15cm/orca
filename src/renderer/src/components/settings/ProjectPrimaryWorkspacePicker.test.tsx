// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { ProjectPrimaryWorkspacePicker } from './ProjectPrimaryWorkspacePicker'

const primary = {
  id: 'repo::/main',
  repoId: 'repo',
  projectId: 'p',
  hostId: 'ssh:host-a',
  instanceId: 'instance-a',
  peerFingerprint: 'peer-a',
  path: '/main',
  displayName: 'Main',
  branch: 'main',
  isArchived: false,
  isBare: false,
  prunable: false
}
const duplicate = {
  ...primary,
  hostId: 'ssh:host-b',
  instanceId: 'instance-b',
  peerFingerprint: 'peer-b',
  displayName: 'Other host'
}
const duplicatePeer = { ...primary, peerFingerprint: 'peer-other', displayName: 'Other peer' }

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('ProjectPrimaryWorkspacePicker', () => {
  it('renders duplicate ids as distinct host rows and disables ineligible rows with reason', async () => {
    useAppStore.setState({
      projects: [
        {
          id: 'p',
          displayName: 'Project',
          badgeColor: '#000',
          sourceRepoIds: ['repo'],
          createdAt: 1,
          updatedAt: 1,
          primaryWorkspace: {
            worktreeId: 'repo::/main',
            instanceId: 'instance-a',
            hostId: 'ssh:host-a',
            path: '/main',
            peerFingerprint: 'peer-a',
            authorityFingerprint: 'authority-a'
          }
        }
      ],
      repos: [
        {
          id: 'repo',
          path: '/repo-a',
          displayName: 'Repo A',
          badgeColor: '#000',
          addedAt: 1,
          connectionId: 'host-a'
        },
        {
          id: 'repo',
          path: '/repo-b',
          displayName: 'Repo B',
          badgeColor: '#000',
          addedAt: 1,
          connectionId: 'host-b'
        }
      ],
      sshConnectionStates: new Map([
        ['host-a', { targetId: 'host-a', status: 'connected', error: null, reconnectAttempt: 0 }],
        ['host-b', { targetId: 'host-b', status: 'connected', error: null, reconnectAttempt: 0 }]
      ]),
      sshTargetLabels: new Map([['host-a', 'Studio SSH'], ['host-b', 'Build SSH']]),
      worktreesByRepo: {
        repo: [
          primary,
          duplicate,
          duplicatePeer,
          {
            ...duplicate,
            id: 'repo::/old',
            instanceId: undefined,
            peerFingerprint: undefined,
            displayName: 'Old entry'
          }
        ]
      }
    } as never)
    render(<ProjectPrimaryWorkspacePicker projectId="p" />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(await screen.findByText('Other host')).toBeTruthy()
    expect(await screen.findByText('Other peer')).toBeTruthy()
    expect(screen.getAllByText(/Studio SSH/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Build SSH/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByPlaceholderText('Search workspace…'), {
      target: { value: 'Studio SSH' }
    })
    expect(screen.getByRole('option', { name: /Main/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Other host/ })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search workspace…'), { target: { value: '' } })
    const mainOption = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('Main'))
    const otherOption = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('Other host'))
    const oldOption = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('Old entry'))
    expect(mainOption?.querySelector('svg')).toBeTruthy()
    expect(otherOption?.querySelector('svg')?.getAttribute('class')).toContain('opacity-40')
    expect(oldOption?.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('Workspace owner identity is unavailable.')).toBeTruthy()
  })

  it('locks choices while request is pending and reports action errors', async () => {
    let resolveAction!: (value: { error: Error }) => void
    const setProjectPrimaryWorkspace = vi.fn(
      () =>
        new Promise<{ error: Error }>((resolve) => {
          resolveAction = resolve
        })
    )
    useAppStore.setState({
      projects: [
        {
          id: 'p',
          displayName: 'Project',
          badgeColor: '#000',
          sourceRepoIds: ['repo'],
          createdAt: 1,
          updatedAt: 1
        }
      ],
      repos: [
        {
          id: 'repo',
          path: '/repo',
          displayName: 'Repo',
          badgeColor: '#000',
          addedAt: 1,
          connectionId: 'host-a'
        }
      ],
      sshConnectionStates: new Map([
        ['host-a', { targetId: 'host-a', status: 'connected', error: null, reconnectAttempt: 0 }]
      ]),
      worktreesByRepo: { repo: [primary] },
      setProjectPrimaryWorkspace
    } as never)
    render(<ProjectPrimaryWorkspacePicker projectId="p" />)
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /Main/ }))
    expect(setProjectPrimaryWorkspace).toHaveBeenCalledOnce()
    const trigger = screen.getAllByRole('combobox')[0]!
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(true))
    resolveAction({ error: new Error('offline') })
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false))
  })

  it('keeps disconnected saved selection visible as unavailable', () => {
    useAppStore.setState({
      projects: [
        {
          id: 'p',
          displayName: 'Project',
          badgeColor: '#000',
          sourceRepoIds: ['repo'],
          createdAt: 1,
          updatedAt: 1,
          primaryWorkspace: {
            worktreeId: primary.id,
            instanceId: primary.instanceId,
            hostId: primary.hostId,
            path: primary.path,
            peerFingerprint: primary.peerFingerprint,
            authorityFingerprint: 'authority-a'
          }
        }
      ],
      repos: [
        {
          id: 'repo',
          path: '/repo',
          displayName: 'Repo',
          badgeColor: '#000',
          addedAt: 1,
          connectionId: 'host-a'
        }
      ],
      sshConnectionStates: new Map([
        ['host-a', { targetId: 'host-a', status: 'disconnected', error: null, reconnectAttempt: 0 }]
      ]),
      worktreesByRepo: { repo: [primary] }
    } as never)
    render(<ProjectPrimaryWorkspacePicker projectId="p" />)
    expect(screen.getByRole('combobox').textContent).toContain('/main')
    expect(screen.getAllByText(/Saved workspace unavailable/)).toHaveLength(2)
  })

  it('shows generic unavailable state for malformed null saved selection', () => {
    useAppStore.setState({
      projects: [
        {
          id: 'p',
          displayName: 'Project',
          badgeColor: '#000',
          sourceRepoIds: ['repo'],
          createdAt: 1,
          updatedAt: 1,
          primaryWorkspace: null as never
        }
      ],
      worktreesByRepo: { repo: [primary] }
    } as never)
    render(<ProjectPrimaryWorkspacePicker projectId="p" />)
    expect(screen.getAllByText('Saved workspace unavailable')).toHaveLength(2)
    expect(screen.queryByText('Choose workspace')).toBeNull()
  })

  it('disables disconnected runtime-owned candidates and keeps saved identity visible', async () => {
    const runtimeTree = {
      ...primary,
      hostId: 'runtime:env-a',
      ownerHostId: 'runtime:env-a',
      runtimeOwnerEnvironmentId: 'env-a'
    }
    useAppStore.setState({
      projects: [
        {
          id: 'p',
          displayName: 'Project',
          badgeColor: '#000',
          sourceRepoIds: ['repo'],
          createdAt: 1,
          updatedAt: 1,
          primaryWorkspace: {
            worktreeId: runtimeTree.id,
            instanceId: runtimeTree.instanceId,
            hostId: 'runtime:env-a',
            path: runtimeTree.path,
            peerFingerprint: runtimeTree.peerFingerprint,
            authorityFingerprint: 'authority-a'
          }
        }
      ],
      repos: [
        {
          id: 'repo',
          path: '/repo',
          displayName: 'Repo',
          badgeColor: '#000',
          addedAt: 1,
          executionHostId: 'runtime:env-a'
        }
      ],
      runtimeStatusByEnvironmentId: new Map([['env-a', { status: null, checkedAt: 1 }]]),
      worktreesByRepo: { repo: [runtimeTree] }
    } as never)
    render(<ProjectPrimaryWorkspacePicker projectId="p" />)
    fireEvent.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: /Main/ })
    expect(option.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByText(/Saved workspace unavailable/)).toHaveLength(2)
  })
})
