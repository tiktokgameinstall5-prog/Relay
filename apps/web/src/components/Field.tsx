/**
 * Labelled form field. The input styling matches
 * workspace-relay-prototype.jsx:291-292 (inputCls / inputStyle), moved onto the
 * @theme tokens.
 *
 * The label is a real <label htmlFor>, not the prototype's bare <label>: these
 * are credential forms, so a click on the label must focus the field and a
 * screen reader must announce it.
 */
import { useState, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
}

export function Field({ label, hint, error, type, className = '', ...rest }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === 'password';
  const effectiveType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[#68707C]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={effectiveType}
          aria-describedby={error !== undefined ? errorId : hint !== undefined ? hintId : undefined}
          aria-invalid={error !== undefined ? true : undefined}
          // className lands on the input, not the wrapper — callers pass things
          // like font-mono for a passcode field, which is about the text.
          className={`focus:ring-signal w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
            isPassword ? 'pr-10' : ''
          } ${
            error !== undefined ? 'border-red-400' : 'border-hairline'
          } ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
            className="text-muted hover:text-ink absolute inset-y-0 right-0 flex items-center pr-3 focus:outline-none"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
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
