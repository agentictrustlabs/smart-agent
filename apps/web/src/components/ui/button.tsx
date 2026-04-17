import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/ui-utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-label-lg font-medium ring-offset-surface transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        filled: 'bg-primary text-on-primary shadow-elevation-1 hover:shadow-elevation-2 hover:brightness-110 active:scale-[0.98]',
        tonal: 'bg-primary-container text-on-primary-container hover:shadow-elevation-1 active:scale-[0.98]',
        outlined: 'border border-outline bg-transparent text-primary hover:bg-primary-container active:scale-[0.98]',
        text: 'text-primary hover:bg-primary-container active:scale-[0.98]',
        destructive: 'bg-error text-on-error shadow-elevation-1 hover:shadow-elevation-2 hover:brightness-110 active:scale-[0.98]',
        ghost: 'text-on-surface-variant hover:bg-surface-variant',
      },
      size: {
        sm: 'h-8 px-3 text-label-md rounded-lg',
        md: 'h-10 px-6 text-label-lg',
        lg: 'h-12 px-8 text-title-sm',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'filled',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
