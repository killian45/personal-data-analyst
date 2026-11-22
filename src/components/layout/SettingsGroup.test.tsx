import { useEffect } from 'react'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SettingsGroup } from './SettingsGroup'

describe('SettingsGroup', () => {
  it('is closed at first but keeps its contents running, and opens on click', async () => {
    const started = vi.fn()

    function Panel() {
      useEffect(() => {
        started()
      }, [])
      return <p>Panel content</p>
    }

    const { container } = render(
      <SettingsGroup title="Import data" description="All imports.">
        <Panel />
      </SettingsGroup>,
    )

    const details = container.querySelector('details')
    expect(details?.open).toBe(false)
    // Mounted while closed: automatic imports inside keep working.
    expect(started).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByText('Import data'))
    expect(details?.open).toBe(true)
    expect(screen.getByText('Panel content')).toBeInTheDocument()
    expect(started).toHaveBeenCalledTimes(1)
  })
})
