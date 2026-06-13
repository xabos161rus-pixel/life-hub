import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-accent to-accent-2 text-white shadow-[0_6px_20px_-9px_var(--app-accent)] active:opacity-95',
  secondary: 'bg-surface-2 text-text active:opacity-80',
  ghost: 'bg-transparent text-accent active:opacity-60',
  danger: 'bg-danger/15 text-danger active:opacity-80',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <button
      className={`rounded-xl px-4 py-3 font-semibold transition-[transform,opacity] duration-150 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
