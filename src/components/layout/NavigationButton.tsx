import type { ReactNode } from 'react'

/** A button of the main navigation (top of the app). */

interface NavigationButtonProps {
  active: boolean
  onClick: () => void
  children: ReactNode
}

export function NavigationButton({
  active,
  onClick,
  children,
}: NavigationButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  )
}
