/** The Quo mark (symbol defined once in index.html), coloured by currentColor. */
export function QuoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 900 755" aria-hidden="true">
      <use href="#quo-mark" />
    </svg>
  );
}
