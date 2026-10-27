import type { ReactNode } from 'react'
import { BrandMark } from './icons'
import { useT } from '../i18n'

export interface NavItem {
  id: string
  label: string
  section: 'main' | 'diagnostics'
  icon: ReactNode
}

interface AppShellProps {
  items: NavItem[]
  active: string
  onNavigate: (id: string) => void
  status?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function AppShell({ items, active, onNavigate, status, footer, children }: AppShellProps) {
  const t = useT()
  const sections: { key: 'main' | 'diagnostics'; label: string }[] = [
    { key: 'main', label: t('nav.section.main') },
    { key: 'diagnostics', label: t('nav.section.diagnostics') }
  ]

  return (
    <div className="flex h-full w-full">
      <aside className="panel-dark flex w-[250px] shrink-0 flex-col border-e border-panel-line bg-panel text-panel-text">
        <div className="flex items-center gap-3 border-b border-panel-line px-5 py-5">
          <BrandMark className="h-8 w-8 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="text-[15px] font-bold leading-snug tracking-tight">{t('app.name')}</div>
            <div className="mt-0.5 text-2xs leading-snug text-panel-muted">{t('app.tagline')}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => {
            const sectionItems = items.filter((item) => item.section === section.key)
            if (sectionItems.length === 0) return null
            return (
              <div key={section.key} className="mb-6 last:mb-0">
                <div className="label-xs px-2 pb-2 text-panel-muted">{section.label}</div>
                <ul className="space-y-0.5">
                  {sectionItems.map((item) => {
                    const isActive = item.id === active
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-nav={item.id}
                          onClick={() => onNavigate(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`flex w-full items-center gap-3 rounded-[3px] border-s-2 px-2.5 py-2 text-start text-sm transition-colors ${
                            isActive
                              ? 'border-s-accent bg-panel-soft font-semibold text-white'
                              : 'border-s-transparent text-panel-muted hover:bg-panel-soft hover:text-panel-text'
                          }`}
                        >
                          <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </nav>

        {status}

        {footer ? (
          <div className="border-t border-panel-line px-5 py-4 text-2xs text-panel-muted">{footer}</div>
        ) : null}
      </aside>

      <main className="panel-light flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1080px] px-8 py-7">{children}</div>
        </div>
      </main>
    </div>
  )
}
