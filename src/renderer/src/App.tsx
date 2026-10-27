import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { AppShell, type NavItem } from './components/AppShell'
import { StatusWidget } from './components/StatusWidget'
import { DatabaseIcon, FolderIcon, GearIcon, ListIcon, SearchIcon } from './components/icons'
import { DiagnosticsView } from './views/DiagnosticsView'
import { FoldersView } from './views/FoldersView'
import { IndexView } from './views/IndexView'
import { LogView } from './views/LogView'
import { SearchView } from './views/SearchView'
import { useT } from './i18n'
import { useIndexCenter } from './state/useIndexCenter'
import { useSearch } from './state/useSearch'

export default function App() {
  const t = useT()
  const center = useIndexCenter()
  const search = useSearch()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [active, setActive] = useState('search')

  useEffect(() => {
    let alive = true
    window.api
      .getAppInfo()
      .then((result) => {
        if (alive) setInfo(result)
      })
      .catch((cause: unknown) => {
        if (alive) setBridgeError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [])

  const items: NavItem[] = [
    { id: 'search', label: t('nav.search'), section: 'main', icon: <SearchIcon /> },
    { id: 'index', label: t('nav.index'), section: 'main', icon: <DatabaseIcon /> },
    { id: 'folders', label: t('nav.folders'), section: 'main', icon: <FolderIcon /> },
    { id: 'log', label: t('nav.log'), section: 'main', icon: <ListIcon /> },
    { id: 'diagnostics', label: t('nav.diagnostics'), section: 'diagnostics', icon: <GearIcon /> }
  ]

  const view = (() => {
    if (active === 'index') return <IndexView center={center} onManageFolders={() => setActive('folders')} />
    if (active === 'folders') return <FoldersView center={center} />
    if (active === 'log') return <LogView center={center} />
    if (active === 'diagnostics') {
      return <DiagnosticsView info={info} error={bridgeError ?? center.error} />
    }
    return <SearchView search={search} center={center} />
  })()

  return (
    <AppShell
      items={items}
      active={active}
      onNavigate={setActive}
      status={<StatusWidget center={center} />}
      footer={info ? `v${info.version} · SQLite ${info.sqliteVersion}` : undefined}
    >
      {view}
    </AppShell>
  )
}
