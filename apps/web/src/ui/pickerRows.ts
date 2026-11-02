/** How many models each section of the model menu shows before "Show more". */
export const SECTION_LIMIT = 3;

/**
 * The rows a section of the model menu shows: the first few, and always the model in use, so the menu stays short but
 * never hides the current choice. Expanded, every row. `hidden` is how many "Show more" would add.
 */
export function visibleRows<T>(items: T[], isSelected: (item: T) => boolean, expanded: boolean, limit = SECTION_LIMIT): { shown: T[]; hidden: number } {
  if (expanded || items.length <= limit) return { shown: items, hidden: 0 };
  const first = items.slice(0, limit);
  const chosen = items.find(isSelected);
  const shown = !chosen || first.includes(chosen) ? first : [...items.slice(0, limit - 1), chosen];
  return { shown, hidden: items.length - shown.length };
}
