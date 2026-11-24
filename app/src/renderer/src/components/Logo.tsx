import { desktopName } from '../../../shared/desktopName'
import lightIcon from '../../../../build/icon.png'
import { MARK, WORD } from '../../../shared/logo'

/** The Yogurt mark. */
export function Logo({ size = 28, className = 'text-accent' }: { size?: number; className?: string }) {
  return (
    <svg data-testid="logo" role="img" aria-label={desktopName} width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${className}`}>
      <path fill="currentColor" d={MARK} />
    </svg>
  )
}

/** The mark with the name next to it, as on the website. Sized by its height. */
export function Wordmark({ height = 32 }: { height?: number }) {
  return (
    <span role="img" aria-label={desktopName} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <svg data-testid="wordmark" aria-hidden="true" height={height} width={(height * 286) / 80} viewBox="0 0 286 80" className="shrink-0">
        <path fill="var(--accent)" transform="translate(0 5) scale(.65)" d={MARK} />
        <path className="text-ink" fill="currentColor" transform="translate(82 55) scale(.068 -.068)" d={WORD} />
      </svg>
      <span aria-hidden="true" className="font-semibold text-ink" style={{ fontSize: height * 0.74 }}>+ Coast</span>
    </span>
  )
}

/** The app tile used by the call prompt and its onboarding illustration. */
export function AppIcon({ className }: { className: string }) {
  return <picture className={className}>
    <source media="(prefers-color-scheme: dark)" srcSet="./favicon-dark.png" />
    <img src={lightIcon} alt="" className="size-full" />
  </picture>
}
