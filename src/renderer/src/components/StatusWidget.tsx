import { Progress } from './primitives'
import { formatNumber } from '../format'
import { useT } from '../i18n'
import type { IndexCenter } from '../state/useIndexCenter'
import type { IndexPhase } from '@shared/types'

const dotTone: Record<IndexPhase, string> = {
  idle: 'bg-panel-muted',
  scanning: 'bg-accent',
  extracting: 'bg-accent',
  finalizing: 'bg-accent',
  done: 'bg-ok',
  cancelled: 'bg-warn',
  error: 'bg-danger'
}

export function StatusWidget({ center }: { center: IndexCenter }) {
  const t = useT()
  const phase: IndexPhase = center.progress?.phase ?? 'idle'

  return (
    <div className="border-t border-panel-line px-5 py-4">
      <div className="label-xs text-panel-muted">{t('sidebar.status.title')}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotTone[phase]}`} />
        <span className="truncate text-xs font-semibold text-panel-text">{t(`index.phase.${phase}`)}</span>
      </div>
      {center.running && center.progress ? (
        <div className="mt-2.5">
          <Progress done={center.progress.extracted} total={center.progress.toExtract} />
        </div>
      ) : (
        <p className="mt-1.5 text-2xs text-panel-muted">
          {t('sidebar.status.files', { count: formatNumber(center.stats?.indexed ?? 0) })}
        </p>
      )}
    </div>
  )
}
