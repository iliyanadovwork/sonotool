'use client';

import React from 'react';

let _id = 0;
function useFieldId(provided?: string) {
  const [auto] = React.useState(() => provided ?? `fld-${++_id}`);
  return provided ?? auto;
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Labelled control wrapper: visible persistent label, optional hint, and a
 *  live-region error. Wires aria-describedby onto the child input automatically. */
export function Field({ label, htmlFor, hint, error, optional, className = '', children }: FieldProps) {
  const id = useFieldId(htmlFor);
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;

  const child = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-label text-label-secondary">
        {label}
        {optional && <span className="text-label-tertiary font-normal"> (optional)</span>}
      </label>
      {child}
      {hint && !error && (
        <p id={hintId} className="text-caption-sm text-label-tertiary">{hint}</p>
      )}
      {error && (
        <p id={errId} role="alert" className="text-caption-sm text-danger">{error}</p>
      )}
    </div>
  );
}

const INPUT_BASE =
  'h-10 w-full px-3 rounded-md bg-surface border border-separator text-body text-label ' +
  'placeholder:text-label-tertiary transition-colors ease-out ' +
  'hover:border-label-quaternary focus:border-tint ' +
  'aria-[invalid=true]:border-danger ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${INPUT_BASE} ${className}`} {...rest} />;
  },
);
