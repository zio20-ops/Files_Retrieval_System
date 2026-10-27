import type { AppInfo } from '@shared/types'
import { AlertIcon, CheckIcon } from '../components/icons'
import { Badge, Card, Field, PageHeader } from '../components/primitives'
import { useT } from '../i18n'

interface DiagnosticsViewProps {
  info: AppInfo | null
  error: string | null
}

export function DiagnosticsView({ info, error }: DiagnosticsViewProps) {
  const t = useT()

  return (
    <div className="space-y-7">
      <PageHeader title={t('diagnostics.title')} subtitle={t('diagnostics.subtitle')} />

      <Card>
        <dl>
          <Field label={t('diagnostics.ipc')}>
            {error ? (
              <Badge tone="danger">
                <AlertIcon className="h-3 w-3" />
                {t('diagnostics.ipc.failed')}
              </Badge>
            ) : info ? (
              <Badge tone="ok">
                <CheckIcon className="h-3 w-3" />
                {t('diagnostics.ipc.connected')}
              </Badge>
            ) : (
              <Badge>{t('common.loading')}</Badge>
            )}
          </Field>
          <Field label={t('diagnostics.version')}>
            <span className="font-mono text-xs">{info ? info.version : '—'}</span>
          </Field>
          <Field label={t('diagnostics.sqliteVersion')}>
            <span className="font-mono text-xs">{info ? info.sqliteVersion : '—'}</span>
          </Field>
          <Field label={t('diagnostics.fts5')}>
            {info ? (
              info.fts5 ? (
                <Badge tone="ok">
                  <CheckIcon className="h-3 w-3" />
                  {t('diagnostics.fts5.available')}
                </Badge>
              ) : (
                <Badge tone="danger">
                  <AlertIcon className="h-3 w-3" />
                  {t('diagnostics.fts5.missing')}
                </Badge>
              )
            ) : (
              <Badge>{t('common.loading')}</Badge>
            )}
          </Field>
          <Field label={t('diagnostics.ocr')}>
            {info ? (
              info.ocrAvailable ? (
                <Badge tone="ok">
                  <CheckIcon className="h-3 w-3" />
                  {t('diagnostics.ocr.available', { languages: info.ocrLanguages })}
                </Badge>
              ) : (
                <Badge tone="warn">
                  <AlertIcon className="h-3 w-3" />
                  {t('diagnostics.ocr.missing')}
                </Badge>
              )
            ) : (
              <Badge>{t('common.loading')}</Badge>
            )}
          </Field>
          {info?.ocrTessdataPath ? (
            <Field label={t('diagnostics.ocr.path')}>
              <span dir="ltr" className="block max-w-[520px] break-all text-end font-mono text-xs text-ink-soft">
                {info.ocrTessdataPath}
              </span>
            </Field>
          ) : null}
          <Field label={t('diagnostics.databasePath')}>
            <span dir="ltr" className="block max-w-[520px] break-all text-end font-mono text-xs text-ink-soft">
              {info ? info.dbPath : '—'}
            </span>
          </Field>
          {error ? (
            <Field label={t('diagnostics.error')}>
              <span dir="ltr" className="block max-w-[520px] break-all text-end font-mono text-xs text-danger">
                {error}
              </span>
            </Field>
          ) : null}
        </dl>
      </Card>
    </div>
  )
}
