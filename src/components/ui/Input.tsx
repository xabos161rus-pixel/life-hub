import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const base =
  'w-full rounded-xl bg-surface-2 border border-hairline px-3.5 py-3 text-text placeholder:text-muted outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/25';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${base} ${className}`} {...props} />;
}

export function Textarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${base} resize-none ${className}`} {...props} />;
}

/** Подпись + контрол — стандартная строка формы в шитах. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
