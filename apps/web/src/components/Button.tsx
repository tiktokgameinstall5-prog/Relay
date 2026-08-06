/**
 * Buttons per CLAUDE.md §9: primary = solid indigo with white text,
 * secondary = white with a hairline border. (Destructive is red-outline and
 * always confirmation-gated — added when something destructive exists to do.)
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

const VARIANTS = {
  primary: 'bg-signal text-white hover:bg-[#2C46D8] disabled:bg-[#A9B5F8]',
  secondary:
    'bg-white text-ink border border-hairline hover:bg-cool-slate disabled:text-[#9AA1AC]',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  full?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  full = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`focus-visible:ring-signal rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed ${
        VARIANTS[variant]
      } ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
