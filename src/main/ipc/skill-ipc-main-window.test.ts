import { beforeEach, describe, expect, it, vi } from 'vitest'

const { isTrustedUIRendererMock, handleMock } = vi.hoisted(() => ({
  isTrustedUIRendererMock: vi.fn(),
  handleMock: vi.fn()
}))

vi.mock('electron', () => ({ ipcMain: { handle: handleMock } }))
vi.mock('./ui', () => ({
  isTrustedUIRenderer: isTrustedUIRendererMock
}))

import { handleMainWindowSkillIpc } from './skill-ipc-main-window'

describe('main-window skill IPC', () => {
  beforeEach(() => {
    handleMock.mockReset()
    isTrustedUIRendererMock.mockReset()
  })

  it('allows the trusted main renderer', () => {
    const listener = vi.fn(() => 'ok')
    const sender = { id: 1 }
    isTrustedUIRendererMock.mockReturnValue(true)
    handleMainWindowSkillIpc('skills:test', listener)

    const handler = handleMock.mock.calls[0][1]
    expect(handler({ sender }, 'value')).toBe('ok')
    expect(listener).toHaveBeenCalledWith({ sender }, 'value')
  })

  it('allows both registered top-level renderers', () => {
    const listener = vi.fn(() => 'ok')
    const first = { id: 1 }
    const second = { id: 2 }
    isTrustedUIRendererMock.mockImplementation((sender) => sender === first || sender === second)
    handleMainWindowSkillIpc('skills:test', listener)

    const handler = handleMock.mock.calls[0][1]
    expect(handler({ sender: first })).toBe('ok')
    expect(handler({ sender: second })).toBe('ok')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['dashboard pop-out', { id: 2 }],
    ['stale renderer', { id: 3 }],
    ['missing main window', { id: 4 }]
  ])('rejects the %s before invoking skill code', (_label, sender) => {
    const listener = vi.fn()
    isTrustedUIRendererMock.mockReturnValue(false)
    handleMainWindowSkillIpc('skills:test', listener)

    const handler = handleMock.mock.calls[0][1]
    expect(() => handler({ sender }, 'value')).toThrow('Unauthorized skill IPC sender')
    expect(listener).not.toHaveBeenCalled()
  })

  it('rejects a stale renderer after its window leaves the registry', () => {
    const listener = vi.fn()
    const trusted = { id: 1 }
    const stale = { id: 2 }
    isTrustedUIRendererMock.mockImplementation((sender) => sender === trusted)
    handleMainWindowSkillIpc('skills:test', listener)

    const handler = handleMock.mock.calls[0][1]
    expect(handler({ sender: trusted })).toBeUndefined()
    expect(() => handler({ sender: stale })).toThrow('Unauthorized skill IPC sender')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
