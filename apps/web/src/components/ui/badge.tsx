import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/ui-utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-label-sm font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary-container text-on-primary-container',
        secondary: 'bg-secondary-container text-secondary',
        outline: 'border border-outline text-on-surface-variant',
        success: 'bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7]',
        error: 'bg-error-container text-error',
        warning: 'bg-[#fff3e0] text-[#e65100] border border-[#ffcc80]',
        person: 'bg-[#e8f5e9] text-type-person border border-[#a5d6a7]',
        org: 'bg-[#e3f2fd] text-type-org border border-[#90caf9]',
        ai: 'bg-[#f3e5f5] text-type-ai border border-[#ce93d8]',
        hub: 'bg-[#fff3e0] text-type-hub border border-[#ffcc80]',
        name: 'bg-primary-container text-primary font-mono border border-primary/15',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
