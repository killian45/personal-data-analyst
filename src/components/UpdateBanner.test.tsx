import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  updateServiceWorker: vi.fn(async () => {}),
}))

// The real module registers a service worker, which jsdom cannot do.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, state.setNeedRefresh],
    offlineReady: [state.offlineReady, state.setOfflineReady],
    updateServiceWorker: state.updateServiceWorker,
  }),
}))

import { UpdateBanner } from './UpdateBanner'

describe('UpdateBanner', () => {
  afterEach(() => {
    cleanup()
    state.needRefresh = false
    state.offlineReady = false
  })

  it('shows nothing when there is no news', () => {
    const { container } = render(<UpdateBanner />)

    expect(container).toBeEmptyDOMElement()
  })

  it('only activates a new version when the user clicks Reload', async () => {
    state.needRefresh = true

    render(<UpdateBanner />)

    expect(screen.getByText(/A new version is available/)).toBeInTheDocument()
    expect(state.updateServiceWorker).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(state.updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('lets the user postpone an update', async () => {
    state.needRefresh = true

    render(<UpdateBanner />)

    await userEvent.click(screen.getByRole('button', { name: 'Later' }))

    expect(state.setNeedRefresh).toHaveBeenCalledWith(false)
    expect(state.updateServiceWorker).not.toHaveBeenCalled()
  })

  it('tells the user when the app is ready offline', async () => {
    state.offlineReady = true

    render(<UpdateBanner />)

    expect(screen.getByText('The app is now ready to work offline.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(state.setOfflineReady).toHaveBeenCalledWith(false)
  })
})
