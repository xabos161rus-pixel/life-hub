import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary: 'bg-accent text-white active:opacity-80',
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
      className={`rounded-xl px-4 py-3 font-semibold transition-opacity disabled:opacity-40 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
