import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { MatchLocation, SearchResult, ShellErrorCode, SortKey } from '@shared/types'
import { ExternalIcon, EyeIcon, FolderIcon, RefreshIcon, ScanIcon, SearchIcon } from '../components/icons'
import { Badge, Banner, Button, Card, EmptyState, PageHeader } from '../components/primitives'
import { formatBytes, formatDateTime, formatNumber } from '../format'
import { isolateText, useT } from '../i18n'
import type { IndexCenter } from '../state/useIndexCenter'
import type { SearchCenter } from '../state/useSearch'

const SORT_KEYS: SortKey[] = ['relevance', 'name', 'modified', 'size']

type ShellKind = 'open' | 'reveal' | 'folder'

interface ShellFailure {
  code: ShellErrorCode
  detail: string | null
  path: string
}

function chipClasses(active: boolean): string {
  const shared =
    'inline-flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1 text-2xs font-semibold transition-colors'
  return active
    ? `${shared} border-accent bg-accent-soft text-accent-text`
    : `${shared} border-line-strong bg-surface text-ink-soft hover:bg-sunken`
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function SearchView({ search, center }: { search: SearchCenter; center: IndexCenter }) {
  const t = useT()
  const { response, loading, error } = search
  const hasQuery = search.submitted.trim().length > 0
  const filtersActive = search.extensions.length > 0 || search.folderIds.length > 0

  const [failure, setFailure] = useState<ShellFailure | null>(null)
  const [thrown, setThrown] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !center.running && search.submitted.trim().length > 0) {
      search.submit(search.submitted)
    }
    wasRunning.current = center.running
  }, [center.running, search])

  const runShell = async (result: SearchResult, kind: ShellKind): Promise<void> => {
    setNotice(null)
    setThrown(null)
    setBusy(`${result.id}:${kind}`)
    try {
      const outcome =
        kind === 'open'
          ? await window.api.openFile(result.id)
          : kind === 'reveal'
            ? await window.api.revealFile(result.id)
            : await window.api.openParentFolder(result.id)
      setFailure(outcome.ok ? null : { code: outcome.code ?? 'open_failed', detail: outcome.detail, path: result.path })
    } catch (cause) {
      setThrown(message(cause))
    } finally {
      setBusy(null)
    }
  }

  const reindex = async (result: SearchResult): Promise<void> => {
    setNotice(null)
    setThrown(null)
    setFailure(null)
    setBusy(`${result.id}:reindex`)
    try {
      await window.api.refreshFile(result.id)
      setNotice(t('result.reindex.done', { name: result.name }))
      search.submit(search.submitted)
    } catch (cause) {
      setThrown(message(cause))
    } finally {
      setBusy(null)
    }
  }

  const runOcr = async (result: SearchResult): Promise<void> => {
    setNotice(null)
    setThrown(null)
    setFailure(null)
    setBusy(`${result.id}:ocr`)
    try {
      await window.api.ocrFile(result.id)
      setNotice(t('result.ocr.done', { name: result.name }))
      search.submit(search.submitted)
    } catch (cause) {
      setThrown(message(cause))
    } finally {
      setBusy(null)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    search.submit()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('search.title')}
        subtitle={t('search.subtitle')}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RefreshIcon />}
              disabled={center.running}
              onClick={() => center.start('incremental')}
              data-action="refresh-index"
            >
              {t('search.action.refresh')}
            </Button>
            {hasQuery ? (
              <Button variant="ghost" onClick={search.clear} data-action="clear-search">
                {t('search.action.clear')}
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <form onSubmit={onSubmit} className="py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-line-strong bg-sunken text-ink-soft">
              <SearchIcon className="h-5 w-5" />
            </span>
            <input
              type="search"
              dir="auto"
              value={search.query}
              placeholder={t('search.placeholder')}
              onChange={(event) => search.setQuery(event.target.value)}
              data-input="search"
              className="h-10 min-w-0 flex-1 border border-line-strong bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-accent"
            />
            <Button type="submit" variant="primary" data-action="search">
              {t('search.action.search')}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-2xs font-semibold text-ink-soft">
              {t('search.sort.label')}
              <select
                value={search.sort}
                onChange={(event) => search.setSort(event.target.value as SortKey)}
                data-select="sort"
                className="border border-line-strong bg-surface px-2 py-1 text-2xs font-semibold text-ink outline-none focus:border-accent"
              >
                {SORT_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {t(`search.sort.${key}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={search.toggleDirection}
              data-action="direction"
              className={chipClasses(false)}
            >
              {search.direction === 'asc' ? t('search.direction.asc') : t('search.direction.desc')}
            </button>
            <span className="min-w-0 flex-1 text-2xs leading-relaxed text-muted">{t('search.hint')}</span>
          </div>
        </form>
      </Card>

      {error ? (
        <Banner tone="danger">
          {t('search.failed')}: {isolateText(error)}
        </Banner>
      ) : null}
      {thrown ? <Banner tone="danger">{isolateText(thrown)}</Banner> : null}
      {failure ? (
        <Banner tone="danger" onDismiss={() => setFailure(null)}>
          {t(`open.error.${failure.code}`, {
            path: failure.path,
            detail: failure.detail ?? ''
          })}
        </Banner>
      ) : null}
      {notice ? (
        <Banner tone="ok" onDismiss={() => setNotice(null)}>
          {isolateText(notice)}
        </Banner>
      ) : null}

      {response && response.total > 0 ? (
        <Card>
          <div className="space-y-3 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label-xs text-ink-soft">{t('search.filters.types')}</span>
              {response.extensionFacets.map((facet) => (
                <button
                  key={facet.key}
                  type="button"
                  onClick={() => search.toggleExtension(facet.key)}
                  aria-pressed={search.extensions.includes(facet.key)}
                  className={chipClasses(search.extensions.includes(facet.key))}
                >
                  {facet.label === 'other' ? t('common.none') : facet.label}
                  <span className="text-muted">{formatNumber(facet.count)}</span>
                </button>
              ))}
            </div>
            {response.folderFacets.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-xs text-ink-soft">{t('search.filters.folders')}</span>
                {response.folderFacets.map((facet) => {
                  const id = Number(facet.key)
                  return (
                    <button
                      key={facet.key}
                      type="button"
                      onClick={() => search.toggleFolder(id)}
                      aria-pressed={search.folderIds.includes(id)}
                      dir="ltr"
                      className={`${chipClasses(search.folderIds.includes(id))} max-w-[280px] truncate font-mono`}
                    >
                      {facet.label}
                      <span className="text-muted">{formatNumber(facet.count)}</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            {filtersActive ? (
              <button
                type="button"
                onClick={search.clearFilters}
                className="text-2xs font-semibold text-accent underline"
              >
                {t('search.filters.clear')}
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <EmptyState title={t('search.results.loading')} />
        </Card>
      ) : null}

      {!loading && hasQuery && response && response.total === 0 ? (
        <Card>
          <EmptyState title={t('search.empty.title')} hint={t('search.empty.hint')} />
        </Card>
      ) : null}

      {!loading && !hasQuery ? (
        <Card>
          <EmptyState title={t('search.start.title')} hint={t('search.start.hint')} />
        </Card>
      ) : null}

      {!loading && response && response.results.length > 0 ? (
        <Card
          title={t('search.results', { total: formatNumber(response.total), ms: formatNumber(response.tookMs) })}
          footer={
            response.total > response.results.length ? (
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  disabled={search.page <= 1}
                  onClick={() => search.goToPage(search.page - 1)}
                  data-action="prev-page"
                >
                  {t('search.page.previous')}
                </Button>
                <span className="text-2xs text-muted">
                  {t('search.page.of', { page: search.page, pages: search.pageCount })}
                </span>
                <Button
                  variant="ghost"
                  disabled={search.page >= search.pageCount}
                  onClick={() => search.goToPage(search.page + 1)}
                  data-action="next-page"
                >
                  {t('search.page.next')}
                </Button>
              </div>
            ) : undefined
          }
        >
          <ul>
            {response.results.map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                busy={busy}
                onShell={(kind) => void runShell(result, kind)}
                onReindex={() => void reindex(result)}
                onOcr={() => void runOcr(result)}
              />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

const matchLabels: Record<MatchLocation, 'search.match.name' | 'search.match.path' | 'search.match.content'> = {
  name: 'search.match.name',
  path: 'search.match.path',
  content: 'search.match.content'
}

const actionButton = 'px-2.5 py-1 text-2xs'

function ResultRow({
  result,
  busy,
  onShell,
  onReindex,
  onOcr
}: {
  result: SearchResult
  busy: string | null
  onShell(kind: ShellKind): void
  onReindex(): void
  onOcr(): void
}) {
  const t = useT()
  const disabled = busy !== null
  return (
    <li className="border-b border-line/70 px-5 py-4 last:border-b-0" data-result={result.name}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="min-w-0 truncate text-sm font-semibold text-ink">{isolateText(result.name)}</p>
        <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-muted">
          {result.ext === '' ? t('common.none') : result.ext}
        </span>
      </div>

      <p dir="ltr" className="mt-1 truncate text-start font-mono text-2xs text-muted">
        {result.parentPath}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {result.matchIn.map((location) => (
          <Badge key={location} tone={location === 'content' ? 'accent' : 'neutral'}>
            {t(matchLabels[location])}
          </Badge>
        ))}
        <span className="text-2xs text-muted">{formatDateTime(result.modifiedAt)}</span>
        <span className="text-2xs text-muted">{formatBytes(result.size)}</span>
      </div>

      {result.snippet ? (
        <p dir="auto" className="mt-2 text-xs leading-relaxed text-ink-soft">
          {result.snippet.map((part, index) =>
            part.hit ? (
              <mark key={index} className="rounded-[2px] bg-accent-soft px-0.5 text-accent-text">
                {part.text}
              </mark>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </p>
      ) : null}

      {result.status !== 'indexed' ? (
        <p className="mt-1.5 text-2xs text-warn">
          {t('search.notReadable', { reason: String(result.skipReason ?? result.status) })}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          icon={<ExternalIcon />}
          className={actionButton}
          disabled={disabled}
          onClick={() => onShell('open')}
          data-action="open-file"
        >
          {t('result.action.open')}
        </Button>
        <Button
          variant="ghost"
          icon={<EyeIcon />}
          className={actionButton}
          disabled={disabled}
          onClick={() => onShell('reveal')}
          data-action="reveal-file"
        >
          {t('result.action.reveal')}
        </Button>
        <Button
          variant="ghost"
          icon={<FolderIcon />}
          className={actionButton}
          disabled={disabled}
          onClick={() => onShell('folder')}
          data-action="open-folder"
        >
          {t('result.action.folder')}
        </Button>
        <Button
          variant="ghost"
          icon={<RefreshIcon />}
          className={actionButton}
          disabled={disabled}
          onClick={onReindex}
          data-action="reindex"
        >
          {t('result.action.reindex')}
        </Button>
        {result.ext === 'pdf' ? (
          <Button
            variant="ghost"
            icon={<ScanIcon />}
            className={actionButton}
            disabled={disabled}
            onClick={onOcr}
            data-action="ocr-file"
          >
            {t('result.action.ocr')}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
