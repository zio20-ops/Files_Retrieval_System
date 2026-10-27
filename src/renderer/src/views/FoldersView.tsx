import { useState } from 'react'
import { Badge, Button, Card, EmptyState, PageHeader, Banner } from '../components/primitives'
import { ExternalIcon, FolderIcon, PlusIcon, TrashIcon } from '../components/icons'
import { formatDateTime, formatNumber } from '../format'
import { isolateText, useT } from '../i18n'
import type { IndexCenter } from '../state/useIndexCenter'
import type { FolderSummary, ShellErrorCode } from '@shared/types'

export function FoldersView({ center }: { center: IndexCenter }) {
  const t = useT()
  const [confirming, setConfirming] = useState<number | null>(null)
  const [failure, setFailure] = useState<{ code: ShellErrorCode; path: string } | null>(null)
  const [thrown, setThrown] = useState<string | null>(null)

  const remove = async (folder: FolderSummary): Promise<void> => {
    setConfirming(null)
    await center.removeFolder(folder.id, folder.path)
  }

  const openInExplorer = async (folder: FolderSummary): Promise<void> => {
    setThrown(null)
    try {
      const outcome = await window.api.openFolder(folder.id)
      setFailure(outcome.ok ? null : { code: outcome.code ?? 'not_directory', path: folder.path })
    } catch (cause) {
      setThrown(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('folders.title')}
        subtitle={t('folders.subtitle')}
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={center.addFolders}>
            {t('folders.action.add')}
          </Button>
        }
      />

      {center.error ? <Banner tone="danger">{isolateText(center.error)}</Banner> : null}
      {thrown ? <Banner tone="danger">{isolateText(thrown)}</Banner> : null}
      {failure ? (
        <Banner tone="danger" onDismiss={() => setFailure(null)}>
          {t(`open.error.${failure.code}`, { path: failure.path, detail: '' })}
        </Banner>
      ) : null}
      {center.notice?.kind === 'duplicate' ? (
        <Banner tone="warn" onDismiss={center.dismissNotice}>
          {t('folders.duplicate', { path: center.notice.path })}
        </Banner>
      ) : null}

      <Card>
        {center.folders.length === 0 ? (
          <EmptyState title={t('folders.empty.title')} hint={t('folders.empty.hint')} />
        ) : (
          <ul className="divide-y divide-line">
            {center.folders.map((folder) => (
              <li key={folder.id} className="flex items-start justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FolderIcon className="h-4 w-4 shrink-0 text-accent" />
                    <span dir="ltr" className="truncate font-mono text-sm text-ink">
                      {folder.path}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {t('folders.counts', {
                      files: formatNumber(folder.fileCount),
                      indexed: formatNumber(folder.indexedCount),
                      skipped: formatNumber(folder.skippedCount)
                    })}
                    {' · '}
                    {folder.lastIndexedAt
                      ? t('folders.lastIndexed', {
                          when: formatDateTime(folder.lastIndexedAt) ?? ''
                        })
                      : t('folders.neverIndexed')}
                  </p>
                </div>

                {confirming === folder.id ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="warn">{t('folders.confirmRemove')}</Badge>
                    <Button variant="danger" onClick={() => void remove(folder)}>
                      {t('common.yes')}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(null)}>
                      {t('common.no')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      icon={<ExternalIcon />}
                      onClick={() => void openInExplorer(folder)}
                      data-action="open-folder"
                    >
                      {t('folders.action.open')}
                    </Button>
                    <Button
                      variant="ghost"
                      icon={<TrashIcon />}
                      onClick={() => setConfirming(folder.id)}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
