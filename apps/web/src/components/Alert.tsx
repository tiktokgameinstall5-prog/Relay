/**
 * Inline banner for form-level messages.
 *
 * role="alert" so the message is announced when it appears — a failed sign-in
 * that is only visible is a failed sign-in for anyone using a screen reader.
 */
import type { ReactNode } from 'react';

const TONES = {
  error: 'bg-red-50 text-red-800 border-red-200',
  info: 'bg-signal-soft text-signal border-[#D5DCFC]',
  success: 'border-[#B9EFD6] bg-[#E7FBF1] text-[#0B7A4B]',
} as const;

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <div
      role="alert"
      className={`rounded-lg border px-3 py-2 text-[13px] ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}
