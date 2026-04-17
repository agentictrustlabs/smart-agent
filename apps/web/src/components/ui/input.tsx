import * as React from 'react'
import { cn } from '@/lib/ui-utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  helperText?: string
  error?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, helperText, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-label-md text-on-surface-variant">{label}</label>
        )}
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-xs border bg-transparent px-3 py-2 text-body-md text-on-surface',
            'placeholder:text-on-surface-variant/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-all duration-200',
            error
              ? 'border-error focus-visible:ring-error'
              : 'border-outline-variant hover:border-outline',
            className,
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-body-sm text-error">{error}</p>}
        {helperText && !error && <p className="text-body-sm text-on-surface-variant">{helperText}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
