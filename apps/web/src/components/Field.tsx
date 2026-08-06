/**
 * Labelled form field. The input styling matches
 * workspace-relay-prototype.jsx:291-292 (inputCls / inputStyle), moved onto the
 * @theme tokens.
 *
 * The label is a real <label htmlFor>, not the prototype's bare <label>: these
 * are credential forms, so a click on the label must focus the field and a
 * screen reader must announce it.
 */
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
}

export function Field({ label, hint, error, className = '', ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[#68707C]">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={error !== undefined ? errorId : hint !== undefined ? hintId : undefined}
        aria-invalid={error !== undefined ? true : undefined}
        // className lands on the input, not the wrapper — callers pass things
        // like font-mono for a passcode field, which is about the text.
        className={`focus:ring-signal w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
          error !== undefined ? 'border-red-400' : 'border-hairline'
        } ${className}`}
        {...rest}
      />
      {error !== undefined && (
        <p id={errorId} className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
      {error === undefined && hint !== undefined && (
        <p id={hintId} className="mt-1 text-[11px] text-[#9AA1AC]">
          {hint}
        </p>
      )}
    </div>
  );
}
