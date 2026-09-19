'use client';

import React from 'react';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'destructive';
type Size = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex items-center justify-center font-medium rounded-md whitespace-nowrap select-none ' +
  'transition-colors ease-out disabled:cursor-not-allowed disabled:opacity-40';

const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 text-caption-sm gap-1.5',   // 32px
  md: 'h-10 px-4 text-caption gap-2',        // 40px
  lg: 'h-12 px-5 text-body gap-2',           // 48px
};

const VARIANT: Record<Variant, string> = {
  // Filled accent w/ white text (AA-safe). One per decision area.
  primary:
    'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-pressed ' +
    'disabled:bg-surface-2 disabled:text-label-quaternary disabled:opacity-100',
  // Neutral, equal-weight secondary action.
  secondary:
    'bg-surface-2 border border-separator text-label-secondary ' +
    'hover:text-label hover:border-label-quaternary active:bg-surface-1',
  // Low-emphasis ghost.
  tertiary:
    'text-label-secondary hover:bg-surface-2 hover:text-label active:bg-surface-1',
  // Destructive (irreversible) — never colour-alone; pair with a clear verb label.
  destructive:
    'text-danger hover:bg-danger/10 active:bg-danger/15',
};

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      className={className} style={{ animation: 'spin 0.8s linear infinite' }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  block = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]} ${block ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        // Keep label in the flow (invisible) so width never jumps.
        <>
          <Spinner className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
          <span className="invisible inline-flex items-center gap-2">{iconLeft}{children}{iconRight}</span>
        </>
      ) : (
        <>
          {iconLeft}
          {children}
          {iconRight}
        </>
      )}
    </button>
  );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required for icon-only controls. */
  label: string;
  variant?: Exclude<Variant, 'primary'>;
  size?: Size;
}

const ICON_SIZE: Record<Size, string> = {
  sm: 'h-8 w-8',    // 32px
  md: 'h-10 w-10',  // 40px
  lg: 'h-11 w-11',  // 44px
};

export function IconButton({
  label,
  variant = 'tertiary',
  size = 'md',
  disabled,
  className = '',
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`${BASE} ${ICON_SIZE[size]} ${VARIANT[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
