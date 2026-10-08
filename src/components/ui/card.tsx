import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-2xl border bg-card text-card-foreground shadow-[0_8px_32px_#30284006] p-5 sm:p-7', className)} {...props} />;
}
