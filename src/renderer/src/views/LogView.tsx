import { Badge, Button, Card, EmptyState, PageHeader, type BadgeTone } from '../components/primitives'
import { RefreshIcon, TrashIcon } from '../components/icons'
import { formatDateTime } from '../format'
import { isolateText, useT } from '../i18n'
import type { IndexCenter } from '../state/useIndexCenter'
import type { LogLevel } from '@shared/types'

const levelTone: Record<LogLevel, BadgeTone> = {
  info: 'neutral',
  warn: 'warn',
  error: 'danger'
}

export function LogView({ center }: { center: IndexCenter }) {
  const t = useT()

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('log.title')}
        subtitle={t('log.subtitle')}
        actions={
          <>
            <Button icon={<RefreshIcon />} onClick={() => void center.reload()}>
              {t('common.refresh')}
            </Button>
            <Button variant="ghost" icon={<TrashIcon />} onClick={() => void center.clearLogs()}>
              {t('log.action.clear')}
            </Button>
          </>
        }
      />

      <Card>
        {center.logs.length === 0 ? (
          <EmptyState title={t('log.empty.title')} hint={t('log.empty.hint')} />
        ) : (
          <ul className="divide-y divide-line">
            {center.logs.map((entry) => (
              <li key={entry.id} className="py-3">
                <div className="flex items-center gap-2">
                  <Badge tone={levelTone[entry.level]}>{t(`log.level.${entry.level}`)}</Badge>
                  {entry.code ? <span className="text-2xs font-semibold text-muted">{entry.code}</span> : null}
                  <span className="ms-auto shrink-0 text-2xs text-muted">
                    {formatDateTime(entry.ts)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-soft">{isolateText(entry.message)}</p>
                {entry.path ? (
                  <p dir="ltr" className="mt-1 truncate text-start font-mono text-2xs text-muted">
                    {entry.path}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
