import { describe, expect, it, vi } from 'vitest'
import { createAgentHookBroadcasterLease } from './agent-hook-broadcaster-lease'

describe('agent-hook broadcaster lease', () => {
  it('installs for the first window, survives siblings, and reinstalls after the final close', () => {
    const install = vi.fn()
    const release = vi.fn()
    const lease = createAgentHookBroadcasterLease()

    if (lease.acquire()) {
      install()
    }
    if (lease.acquire()) {
      install()
    }
    expect(install).toHaveBeenCalledOnce()
    expect(lease.getCount()).toBe(2)

    expect(lease.release()).toBe(false)
    expect(release).not.toHaveBeenCalled()
    expect(lease.getCount()).toBe(1)

    if (lease.release()) {
      release()
    }
    expect(release).toHaveBeenCalledOnce()
    expect(lease.getCount()).toBe(0)

    if (lease.acquire()) {
      install()
    }
    expect(install).toHaveBeenCalledTimes(2)
    expect(lease.getCount()).toBe(1)
  })

  it('does not underflow or report a final release without an active window', () => {
    const lease = createAgentHookBroadcasterLease()

    expect(lease.release()).toBe(false)
    expect(lease.getCount()).toBe(0)
  })
})
