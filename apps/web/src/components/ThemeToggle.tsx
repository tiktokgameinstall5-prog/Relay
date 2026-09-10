import { Sun, Moon, Laptop } from 'lucide-react';
import { useTheme, type Theme } from '../theme/ThemeContext';

export function ThemeToggle({
  className = '',
}: {
  className?: string;
}) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const toggleNext = () => {
    if (theme === 'system') {
      // If currently following system, flip to opposite of current system appearance
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    } else if (theme === 'light') {
      setTheme('dark');
    } else {
      setTheme('light');
    }
  };

  return (
    <button
      type="button"
      onClick={toggleNext}
      aria-label={`Switch theme (currently ${theme}, ${resolvedTheme} applied)`}
      title={`Theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)} (Click to toggle)`}
      className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shadow-2xs ${className}`}
    >
      {resolvedTheme === 'dark' ? (
        <Moon size={15} className="transition-transform rotate-0 scale-100 text-indigo-400" />
      ) : (
        <Sun size={15} className="transition-transform rotate-0 scale-100 text-amber-500" />
      )}
    </button>
  );
}

/**
 * Segmented control for detailed theme selection (Light / Dark / System),
 * ideal for Settings & Profile pages.
 */
export function ThemeSegmentedControl() {
  const { theme, setTheme } = useTheme();

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Laptop },
  ];

  return (
    <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 p-1 gap-1">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isActive
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Icon size={14} className={isActive ? 'text-signal dark:text-blue-400' : ''} />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
