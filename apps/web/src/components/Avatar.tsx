/**
 * Initials avatar. Rebuilt from workspace-relay-prototype.jsx:104-114.
 *
 * The prototype styles this inline from its `C` token object because it has no
 * Tailwind config to hang tokens on. Here the same hex values are already
 * @theme tokens in index.css, so it uses utilities — one copy of the palette.
 *
 * Size stays an inline style: it is a numeric prop, and Tailwind cannot
 * generate a class from a runtime value.
 */
export function Avatar({
  name,
  size = 32,
  ring = false,
}: {
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const initials = name
    .split(' ')
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      className={`font-display flex shrink-0 items-center justify-center rounded-full font-semibold ${
        ring
          ? 'bg-active border-active border-2 text-white'
          : 'border-hairline border bg-[#EEF0F3] text-[#68707C]'
      }`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
