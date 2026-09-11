import { afterEach, describe, expect, it, vi } from 'vitest'
import { IMPLICIT_WINDOW_ID } from '../../../shared/window-identity'
import { withFallback } from '../web/preload-api/web-fallback-api'
import { getRendererWindowId } from './window-identity'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getRendererWindowId', () => {
  it('reads the id the preload learned from its launch arguments', () => {
    vi.stubGlobal('api', { windowIdentity: { windowId: 'win-a' } })

    expect(getRendererWindowId()).toBe('win-a')
  })

  it('degrades to the implicit window when the preload reports none', () => {
    vi.stubGlobal('api', { windowIdentity: { windowId: null } })

    expect(getRendererWindowId()).toBe(IMPLICIT_WINDOW_ID)
  })

  it('degrades to the implicit window behind the web client fallback proxy', () => {
    // Why: the paired web client answers unknown API paths with a callable proxy, never undefined.
    vi.stubGlobal('api', withFallback({}, []))

    expect(getRendererWindowId()).toBe(IMPLICIT_WINDOW_ID)
  })
})
