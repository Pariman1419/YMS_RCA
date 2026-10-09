import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import * as React from 'react';
import { twMerge } from 'tailwind-merge';
const variants = cva(
  'yms-button inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-cyan-400 text-slate-950 hover:bg-cyan-300',
        outline: 'border border-slate-600 text-slate-100 hover:bg-slate-700',
        ghost: 'text-slate-300 hover:bg-slate-700',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3', icon: 'h-10 w-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {
  asChild?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        data-variant={variant || 'default'}
        className={twMerge(clsx(variants({ variant, size }), className))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
