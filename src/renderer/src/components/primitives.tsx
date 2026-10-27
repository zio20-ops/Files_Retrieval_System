import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-6 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  subtitle,
  children,
  footer
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="rounded-[4px] border border-line bg-surface shadow-card">
      {title ? (
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="label-xs text-ink-soft">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
        </div>
      ) : null}
      <div className="px-5 py-1">{children}</div>
      {footer ? <div className="border-t border-line px-5 py-3">{footer}</div> : null}
    </section>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line/70 py-3 last:border-b-0">
      <dt className="shrink-0 text-sm text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-end text-sm text-ink">{children}</dd>
    </div>
  )
}

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'border-line-strong bg-sunken text-ink-soft',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  accent: 'border-accent/30 bg-accent-soft text-accent-text'
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-2 py-0.5 text-2xs font-semibold ${badgeTones[tone]}`}
    >
      {children}
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'border-accent bg-accent text-white hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-sunken',
  ghost: 'border-transparent bg-transparent text-ink-soft hover:bg-sunken hover:text-ink',
  danger: 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
}

export function Button({ variant = 'secondary', icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-[3px] border px-3.5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${buttonVariants[variant]} ${className}`}
    >
      {icon ? <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      {children}
    </button>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-semibold text-ink-soft">{title}</p>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}

export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-[2px] bg-sunken"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
    </div>
  )
}

export function Banner({
  tone,
  children,
  onDismiss
}: {
  tone: BadgeTone
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-[4px] border px-4 py-3 text-sm ${badgeTones[tone]}`}
    >
      <span className="min-w-0">{children}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="shrink-0 text-2xs font-semibold underline">
          ×
        </button>
      ) : null}
    </div>
  )
}
