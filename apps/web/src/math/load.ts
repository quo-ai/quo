import 'katex/dist/katex.min.css';
import type { Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

/**
 * The maths plugins, in their own file so they load only when a reply has maths (useMath.ts; the build names the file
 * math-*, cached on first use). KaTeX runs with trust off (no links, classes or styles from the text), a cap on macro
 * expansion and size, and draws a formula it can't read in the error colour instead of failing the reply.
 */

type Plugin = NonNullable<Options['remarkPlugins']>[number];

export interface MathPlugins { remark: Plugin; rehype: Plugin }

export const MATH: MathPlugins = {
  remark: [remarkMath, { singleDollarTextMath: true }],
  rehype: [rehypeKatex, { throwOnError: false, errorColor: 'var(--error)', strict: 'ignore', trust: false, maxSize: 20, maxExpand: 500, output: 'htmlAndMathml' }],
};
