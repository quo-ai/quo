import { Fragment, type ReactNode } from 'react';

/**
 * Facts about a thing (a model's provider and price, a key's status and model count), each its own item with a thin
 * rule between them, never one string joined with dots. Screen readers hear a comma where the rule is.
 */
export function Facts({ items }: { items: (ReactNode | false | null | undefined)[] }) {
  const shown = items.filter(item => item !== false && item !== null && item !== undefined && item !== '');
  return (
    <>
      {shown.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="vh">, </span>}
          <span className="fact">{item}</span>
        </Fragment>
      ))}
    </>
  );
}
