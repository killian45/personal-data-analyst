import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAppleMobile } from '../platform/appleMobile'
import { InstallPanel } from './InstallPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('install guide (sharing plan S6)', () => {
  it('recognises iPhones and iPads (iPadOS reports a Mac with touch)', () => {
    expect(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)).toBe(true)
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(isAppleMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(isAppleMobile('Mozilla/5.0 (Linux; Android 15)', 5)).toBe(false)
  })

  it('explains how to install on each kind of device', () => {
    render(<InstallPanel />)
    expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeInTheDocument()
    expect(screen.getByText(/install icon at the right of the address bar/)).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('warns iPhone users first about the limits and Home Screen', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 })
    render(<InstallPanel />)
    expect(screen.getByRole('note')).toHaveTextContent(/no Health Connect and no screen time/)
  })
})
