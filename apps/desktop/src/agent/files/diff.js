'use strict';

/** A small unified diff of two texts, with a few lines of context. */
function unifiedDiff(before, after, context = 3) {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 4_000_000) {
    return { text: `(${a.length} lines became ${b.length}; too large to show line by line)`, added: Math.max(0, b.length - a.length), removed: Math.max(0, a.length - b.length) };
  }
  // Trim the shared start and end so the table below only covers what changed.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const table = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) table[i][j] = x[i] === y[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const ops = [];
  for (let i = 0, j = 0; i < x.length || j < y.length;) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push([' ', x[i]]);
      i++;
      j++;
    } else if (i < x.length && (j === y.length || table[i + 1][j] >= table[i][j + 1])) ops.push(['-', x[i++]]);
    else ops.push(['+', y[j++]]);
  }
  const all = [...a.slice(Math.max(0, head - context), head).map(line => [' ', line]), ...ops, ...a.slice(a.length - tail, a.length - tail + context).map(line => [' ', line])];
  let added = 0;
  let removed = 0;
  for (const [mark] of all) {
    if (mark === '+') added++;
    if (mark === '-') removed++;
  }
  // Drop long unchanged stretches inside the diff.
  const out = [];
  let quiet = 0;
  all.forEach(([mark, line], index) => {
    if (mark !== ' ') {
      quiet = 0;
      out.push(`${mark}${line}`);
      return;
    }
    const nearChange = all.slice(Math.max(0, index - context), index + context + 1).some(([m]) => m !== ' ');
    if (nearChange) out.push(` ${line}`);
    else if (++quiet === 1) out.push('…');
  });
  return { text: out.join('\n'), added, removed };
}

module.exports = { unifiedDiff };
