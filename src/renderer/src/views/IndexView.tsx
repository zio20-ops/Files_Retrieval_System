import { Badge, Button, Card, EmptyState, Field, PageHeader, Progress, Banner } from '../components/primitives'
import { FolderIcon, PlusIcon, RefreshIcon, StopIcon } from '../components/icons'
import { formatBytes, formatNumber } from '../format'
import { isolateText, useT } from '../i18n'
import type { IndexCenter } from '../state/useIndexCenter'
import type { IndexPhase } from '@shared/types'

const phaseTone: Record<IndexPhase, 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'> = {
  idle: 'neutral',
  scanning: 'accent',
  extracting: 'accent',
  finalizing: 'accent',
  done: 'ok',
  cancelled: 'warn',
  error: 'danger'
}

export function IndexView({ center, onManageFolders }: { center: IndexCenter; onManageFolders: () => void }) {
  const t = useT()
  const { progress, stats, folders, running, error, notice } = center
  const phase: IndexPhase = progress?.phase ?? 'idle'

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('index.title')}
        subtitle={t('index.subtitle')}
        actions={
          running ? (
            <Button variant="danger" icon={<StopIcon />} data-action="stop" onClick={center.cancel}>
              {t('index.action.stop')}
            </Button>
          ) : (
            <>
              <Button icon={<RefreshIcon />} data-action="refresh" onClick={() => center.start('incremental')}>
                {t('index.action.refresh')}
              </Button>
              <Button variant="primary" icon={<RefreshIcon />} data-action="rebuild" onClick={() => center.start('full')}>
                {t('index.action.rebuild')}
              </Button>
            </>
          )
        }
      />

      {error ? <Banner tone="danger">{isolateText(error)}</Banner> : null}
      {notice ? (
        <Banner tone={notice.kind === 'removed' ? 'ok' : 'warn'} onDismiss={center.dismissNotice}>
          {notice.kind === 'duplicate'
            ? t('folders.duplicate', { path: notice.path })
            : t('folders.removed', { path: notice.path })}
        </Banner>
      ) : null}

      {folders.length === 0 ? (
        <Card>
          <EmptyState title={t('index.empty.title')} hint={t('index.empty.hint')} />
          <div className="flex justify-center pb-6">
            <Button variant="primary" icon={<PlusIcon />} onClick={center.addFolders}>
              {t('folders.action.add')}
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card title={t('sidebar.status.title')}>
            <dl>
              <Field label={t('index.phase')}>
                <Badge tone={phaseTone[phase]}>{t(`index.phase.${phase}`)}</Badge>
              </Field>
              {running && progress ? (
                <Field label={t('index.progress', { done: progress.extracted, total: progress.toExtract })}>
                  <span className="block w-56">
                    <Progress done={progress.extracted} total={progress.toExtract} />
                  </span>
                </Field>
              ) : null}
              {running && progress?.ocr ? (
                <Field label={t('index.ocr')}>
                  <span className="block w-56 space-y-1">
                    <span className="block text-2xs font-semibold text-accent-text">
                      {t('index.ocr.page', { page: progress.ocr.page, pages: progress.ocr.pages })}
                    </span>
                    <Progress done={progress.ocr.page} total={progress.ocr.pages} />
                    <span className="block text-2xs text-muted">{t('index.ocr.hint')}</span>
                  </span>
                </Field>
              ) : null}
              {progress?.currentFile ? (
                <Field label={t('index.currentFile')}>
                  <span dir="ltr" className="block truncate font-mono text-xs text-muted">
                    {progress.currentFile}
                  </span>
                </Field>
              ) : null}
              {progress?.error ? (
                <Field label={t('index.phase.error')}>{isolateText(progress.error)}</Field>
              ) : null}
            </dl>
          </Card>

          <Card
            title={t('index.stats.title')}
            footer={
              <Button variant="ghost" icon={<FolderIcon />} onClick={onManageFolders}>
                {t('index.action.folders')}
              </Button>
            }
          >
            <dl>
              <Field label={t('index.stat.folders')}>{formatNumber(stats?.folders ?? 0)}</Field>
              <Field label={t('index.stat.files')}>{formatNumber(stats?.files ?? 0)}</Field>
              <Field label={t('index.stat.indexed')}>{formatNumber(stats?.indexed ?? 0)}</Field>
              <Field label={t('index.stat.nameOnly')}>{formatNumber(stats?.nameOnly ?? 0)}</Field>
              <Field label={t('index.stat.pending')}>{formatNumber(stats?.pending ?? 0)}</Field>
              <Field label={t('index.stat.skipped')}>{formatNumber(stats?.skipped ?? 0)}</Field>
              <Field label={t('index.stat.errored')}>{formatNumber(stats?.errored ?? 0)}</Field>
              <Field label={t('index.stat.chunks')}>{formatNumber(stats?.chunks ?? 0)}</Field>
              <Field label={t('index.stat.dbSize')}>{formatBytes(stats?.dbSizeBytes ?? 0)}</Field>
            </dl>
          </Card>
        </>
      )}
    </div>
  )
}
