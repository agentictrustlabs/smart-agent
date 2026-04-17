import Link from 'next/link'
import { cn } from '@/lib/ui-utils'

interface KpiCardProps {
  label: string
  href: string
  children: React.ReactNode
  className?: string
}

export function KpiCard({ label, href, children, className }: KpiCardProps) {
  return (
    <Link href={href} className={cn('block no-underline group', className)}>
      <div className="bg-white border border-outline-variant rounded-md p-4 flex flex-col gap-1 min-h-[80px] shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 group-hover:border-primary/20">
        <span className="text-label-sm text-on-surface-variant uppercase tracking-wider font-bold">
          {label}
        </span>
        <div className="flex items-baseline gap-1.5 flex-1">
          {children}
        </div>
      </div>
    </Link>
  )
}

export function KpiValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('text-headline-sm font-bold text-primary', className)}>{children}</span>
}

export function KpiLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-body-sm text-on-surface-variant">{children}</span>
}
