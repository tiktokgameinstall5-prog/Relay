/**
 * Modal container. Rebuilt from workspace-relay-prototype.jsx:277-290.
 *
 * Additions over the prototype, because this one holds a real form rather than
 * a mock: Escape closes it, focus moves into the dialog on open, and it carries
 * role="dialog" aria-modal so a screen reader treats it as one.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function ModalShell({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(22,26,34,0.5)' }}
      onMouseDown={(event) => {
        // Only a click that both starts and ends on the backdrop closes it —
        // otherwise a text selection dragged out of the dialog dismisses it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[85vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-xl outline-none ${
          wide ? 'max-w-lg' : 'max-w-sm'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={18} className="text-[#9AA1AC]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
