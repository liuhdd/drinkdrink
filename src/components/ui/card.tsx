import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-lg bg-card p-5 text-card-foreground shadow-[var(--shadow-card)] sm:p-6', className)} {...props} />;
}
