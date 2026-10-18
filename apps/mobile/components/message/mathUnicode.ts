// ─── LaTeX / Math → Unicode pre-processing ────────────────────────────
// Instead of splitting content into segments and rendering them as
// separate Views (which breaks paragraph flow), we convert all LaTeX
// math expressions to Unicode text *inline* within the original string,
// then hand the whole thing to a single <Markdown> component.

/** Unicode superscript mapping */
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ', 'a': 'ᵃ',
  'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ',
  'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ',
  'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ',
  't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'z': 'ᶻ',
  'T': 'ᵀ',
};

/** Unicode subscript mapping */
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
  'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
  'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
  'v': 'ᵥ', 'x': 'ₓ',
};

function toSuperscript(s: string): string {
  return s.split('').map(c => SUPERSCRIPT[c] || c).join('');
}
function toSubscript(s: string): string {
  return s.split('').map(c => SUBSCRIPT[c] || c).join('');
}

/** Greek letters — lowercase and uppercase */
const GREEK: [RegExp, string][] = [
  // Lowercase
  [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'],
  [/\\delta/g, 'δ'], [/\\epsilon/g, 'ε'], [/\\varepsilon/g, 'ε'],
  [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'], [/\\theta/g, 'θ'],
  [/\\vartheta/g, 'ϑ'], [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'],
  [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\nu/g, 'ν'],
  [/\\xi/g, 'ξ'], [/\\omicron/g, 'ο'], [/\\pi/g, 'π'],
  [/\\varpi/g, 'ϖ'], [/\\rho/g, 'ρ'], [/\\varrho/g, 'ϱ'],
  [/\\sigma/g, 'σ'], [/\\varsigma/g, 'ς'], [/\\tau/g, 'τ'],
  [/\\upsilon/g, 'υ'], [/\\phi/g, 'φ'], [/\\varphi/g, 'φ'],
  [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'], [/\\omega/g, 'ω'],
  // Uppercase
  [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'],
  [/\\Lambda/g, 'Λ'], [/\\Xi/g, 'Ξ'], [/\\Pi/g, 'Π'],
  [/\\Sigma/g, 'Σ'], [/\\Upsilon/g, 'Υ'], [/\\Phi/g, 'Φ'],
  [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],
];

/**
 * Convert a LaTeX math expression to Unicode-rich plain text.
 * Handles fractions, roots, super/subscripts, Greek, operators,
 * relations, set theory, calculus, logic, arrows, accents, etc.
 */
export function latexToUnicode(tex: string): string {
  let s = tex;

  // ── Structural / font commands ──────────────────────────────────────
  s = s.replace(/\\(?:text|mathrm|textit|textrm|mathit|mbox)\{([^}]*)\}/g, '$1');
  s = s.replace(/\\(?:mathbf|boldsymbol|bm)\{([^}]*)\}/g, '$1');
  s = s.replace(/\\(?:mathbb|mathcal|mathfrak|mathsf|mathtt)\{([^}]*)\}/g, '$1');
  s = s.replace(/\\(?:operatorname|DeclareMathOperator)\*?\{([^}]*)\}/g, '$1');
  s = s.replace(/\\boxed\{([^}]*)\}/g, '[$1]');
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg|middle)[\.\s]?/g, '');
  s = s.replace(/\\(?:displaystyle|textstyle|scriptstyle|scriptscriptstyle)/g, '');
  s = s.replace(/\\(?:phantom|hphantom|vphantom)\{[^}]*\}/g, '');
  s = s.replace(/\\(?:hspace|vspace|kern|mkern|mskip|hskip)\{[^}]*\}/g, ' ');
  s = s.replace(/\\(?:quad|qquad)/g, '  ');
  s = s.replace(/\\[,;:!]/g, ' ');
  s = s.replace(/\\(?:nonumber|notag|label\{[^}]*\})/g, '');
  s = s.replace(/\\(?:tag\{([^}]*)\})/g, '  ($1)');

  // ── Fractions (handle nested braces via multiple passes) ────────────
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\(?:frac|dfrac|tfrac|cfrac)\{([^}]*)\}\{([^}]*)\}/g, '($1/$2)');
  }

  // ── Roots ───────────────────────────────────────────────────────────
  s = s.replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, (_, n, body) => `${toSuperscript(n)}√(${body})`);
  s = s.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
  s = s.replace(/\\sqrt(?:\s|$)/g, '√');

  // ── Superscripts & subscripts ───────────────────────────────────────
  // Braced: ^{...}  _{...}
  s = s.replace(/\^\{([^}]*)\}/g, (_, inner) => toSuperscript(latexToUnicode(inner)));
  s = s.replace(/_\{([^}]*)\}/g, (_, inner) => toSubscript(latexToUnicode(inner)));
  // Single char: ^x  _x
  s = s.replace(/\^([a-zA-Z0-9+\-])/g, (_, c) => SUPERSCRIPT[c] || `^${c}`);
  s = s.replace(/_([a-zA-Z0-9+\-])/g, (_, c) => SUBSCRIPT[c] || `_${c}`);

  // ── Greek letters ───────────────────────────────────────────────────
  for (const [pat, rep] of GREEK) {
    s = s.replace(pat, rep);
  }

  // ── Binary / arithmetic operators ───────────────────────────────────
  s = s.replace(/\\times/g, '×');
  s = s.replace(/\\cdot/g, '·');
  s = s.replace(/\\div/g, '÷');
  s = s.replace(/\\pm/g, '±');
  s = s.replace(/\\mp/g, '∓');
  s = s.replace(/\\ast/g, '∗');
  s = s.replace(/\\star/g, '⋆');
  s = s.replace(/\\circ/g, '∘');
  s = s.replace(/\\bullet/g, '•');
  s = s.replace(/\\oplus/g, '⊕');
  s = s.replace(/\\otimes/g, '⊗');
  s = s.replace(/\\odot/g, '⊙');

  // ── Relations ───────────────────────────────────────────────────────
  s = s.replace(/\\leq/g, '≤');  s = s.replace(/\\le([^a-z])/g, '≤$1');
  s = s.replace(/\\geq/g, '≥');  s = s.replace(/\\ge([^a-z])/g, '≥$1');
  s = s.replace(/\\neq/g, '≠');  s = s.replace(/\\ne([^a-z])/g, '≠$1');
  s = s.replace(/\\approx/g, '≈');
  s = s.replace(/\\equiv/g, '≡');
  s = s.replace(/\\cong/g, '≅');
  s = s.replace(/\\sim/g, '∼');
  s = s.replace(/\\simeq/g, '≃');
  s = s.replace(/\\propto/g, '∝');
  s = s.replace(/\\perp/g, '⊥');
  s = s.replace(/\\parallel/g, '∥');
  s = s.replace(/\\ll/g, '≪');
  s = s.replace(/\\gg/g, '≫');
  s = s.replace(/\\prec/g, '≺');
  s = s.replace(/\\succ/g, '≻');
  s = s.replace(/\\preceq/g, '⪯');
  s = s.replace(/\\succeq/g, '⪰');
  s = s.replace(/\\doteq/g, '≐');

  // ── Set theory ──────────────────────────────────────────────────────
  s = s.replace(/\\in([^a-z])/g, '∈$1');
  s = s.replace(/\\notin/g, '∉');
  s = s.replace(/\\ni/g, '∋');
  s = s.replace(/\\subset/g, '⊂');
  s = s.replace(/\\supset/g, '⊃');
  s = s.replace(/\\subseteq/g, '⊆');
  s = s.replace(/\\supseteq/g, '⊇');
  s = s.replace(/\\cup/g, '∪');
  s = s.replace(/\\cap/g, '∩');
  s = s.replace(/\\setminus/g, '∖');
  s = s.replace(/\\emptyset/g, '∅');
  s = s.replace(/\\varnothing/g, '∅');

  // ── Logic ───────────────────────────────────────────────────────────
  s = s.replace(/\\forall/g, '∀');
  s = s.replace(/\\exists/g, '∃');
  s = s.replace(/\\nexists/g, '∄');
  s = s.replace(/\\neg/g, '¬');
  s = s.replace(/\\lnot/g, '¬');
  s = s.replace(/\\land/g, '∧');
  s = s.replace(/\\lor/g, '∨');
  s = s.replace(/\\implies/g, '⟹');
  s = s.replace(/\\impliedby/g, '⟸');
  s = s.replace(/\\iff/g, '⟺');
  s = s.replace(/\\therefore/g, '∴');
  s = s.replace(/\\because/g, '∵');
  s = s.replace(/\\top/g, '⊤');
  s = s.replace(/\\bot/g, '⊥');
  s = s.replace(/\\vdash/g, '⊢');
  s = s.replace(/\\models/g, '⊨');

  // ── Calculus / analysis ─────────────────────────────────────────────
  s = s.replace(/\\partial/g, '∂');
  s = s.replace(/\\nabla/g, '∇');
  s = s.replace(/\\infty/g, '∞');
  s = s.replace(/\\int/g, '∫');
  s = s.replace(/\\iint/g, '∬');
  s = s.replace(/\\iiint/g, '∭');
  s = s.replace(/\\oint/g, '∮');
  s = s.replace(/\\sum/g, '∑');
  s = s.replace(/\\prod/g, '∏');
  s = s.replace(/\\coprod/g, '∐');
  s = s.replace(/\\lim/g, 'lim');
  s = s.replace(/\\limsup/g, 'lim sup');
  s = s.replace(/\\liminf/g, 'lim inf');
  s = s.replace(/\\sup/g, 'sup');
  s = s.replace(/\\inf([^a-z])/g, 'inf$1');
  s = s.replace(/\\max/g, 'max');
  s = s.replace(/\\min/g, 'min');
  s = s.replace(/\\arg/g, 'arg');
  s = s.replace(/\\det/g, 'det');
  s = s.replace(/\\dim/g, 'dim');
  s = s.replace(/\\ker/g, 'ker');
  s = s.replace(/\\deg/g, 'deg');
  s = s.replace(/\\hom/g, 'Hom');
  s = s.replace(/\\exp/g, 'exp');
  s = s.replace(/\\log/g, 'log');
  s = s.replace(/\\ln/g, 'ln');
  s = s.replace(/\\lg/g, 'lg');

  // ── Trigonometric ───────────────────────────────────────────────────
  s = s.replace(/\\sin/g, 'sin');
  s = s.replace(/\\cos/g, 'cos');
  s = s.replace(/\\tan/g, 'tan');
  s = s.replace(/\\cot/g, 'cot');
  s = s.replace(/\\sec/g, 'sec');
  s = s.replace(/\\csc/g, 'csc');
  s = s.replace(/\\arcsin/g, 'arcsin');
  s = s.replace(/\\arccos/g, 'arccos');
  s = s.replace(/\\arctan/g, 'arctan');
  s = s.replace(/\\sinh/g, 'sinh');
  s = s.replace(/\\cosh/g, 'cosh');
  s = s.replace(/\\tanh/g, 'tanh');

  // ── Arrows ──────────────────────────────────────────────────────────
  s = s.replace(/\\Rightarrow/g, '⇒');
  s = s.replace(/\\Leftarrow/g, '⇐');
  s = s.replace(/\\Leftrightarrow/g, '⇔');
  s = s.replace(/\\rightarrow/g, '→');
  s = s.replace(/\\leftarrow/g, '←');
  s = s.replace(/\\leftrightarrow/g, '↔');
  s = s.replace(/\\longrightarrow/g, '⟶');
  s = s.replace(/\\longleftarrow/g, '⟵');
  s = s.replace(/\\mapsto/g, '↦');
  s = s.replace(/\\longmapsto/g, '⟼');
  s = s.replace(/\\uparrow/g, '↑');
  s = s.replace(/\\downarrow/g, '↓');
  s = s.replace(/\\Uparrow/g, '⇑');
  s = s.replace(/\\Downarrow/g, '⇓');
  s = s.replace(/\\nearrow/g, '↗');
  s = s.replace(/\\searrow/g, '↘');
  s = s.replace(/\\hookrightarrow/g, '↪');
  s = s.replace(/\\hookleftarrow/g, '↩');
  s = s.replace(/\\to([^a-z])/g, '→$1');

  // ── Delimiters / brackets ───────────────────────────────────────────
  s = s.replace(/\\langle/g, '⟨');
  s = s.replace(/\\rangle/g, '⟩');
  s = s.replace(/\\lfloor/g, '⌊');
  s = s.replace(/\\rfloor/g, '⌋');
  s = s.replace(/\\lceil/g, '⌈');
  s = s.replace(/\\rceil/g, '⌉');
  s = s.replace(/\\lvert/g, '|');
  s = s.replace(/\\rvert/g, '|');
  s = s.replace(/\\lVert/g, '‖');
  s = s.replace(/\\rVert/g, '‖');
  s = s.replace(/\\{/g, '{');
  s = s.replace(/\\}/g, '}');

  // ── Miscellaneous symbols ───────────────────────────────────────────
  s = s.replace(/\\aleph/g, 'ℵ');
  s = s.replace(/\\beth/g, 'ℶ');
  s = s.replace(/\\ell/g, 'ℓ');
  s = s.replace(/\\wp/g, '℘');
  s = s.replace(/\\Re/g, 'ℜ');
  s = s.replace(/\\Im/g, 'ℑ');
  s = s.replace(/\\hbar/g, 'ℏ');
  s = s.replace(/\\dagger/g, '†');
  s = s.replace(/\\ddagger/g, '‡');
  s = s.replace(/\\prime/g, '′');
  s = s.replace(/\\angle/g, '∠');
  s = s.replace(/\\triangle/g, '△');
  s = s.replace(/\\square/g, '□');
  s = s.replace(/\\diamond/g, '◇');
  s = s.replace(/\\clubsuit/g, '♣');
  s = s.replace(/\\diamondsuit/g, '♦');
  s = s.replace(/\\heartsuit/g, '♥');
  s = s.replace(/\\spadesuit/g, '♠');
  s = s.replace(/\\checkmark/g, '✓');
  s = s.replace(/\\ldots/g, '…');
  s = s.replace(/\\cdots/g, '⋯');
  s = s.replace(/\\vdots/g, '⋮');
  s = s.replace(/\\ddots/g, '⋱');
  s = s.replace(/\\dots/g, '…');

  // ── Accents ─────────────────────────────────────────────────────────
  s = s.replace(/\\hat\{([^}])\}/g, '$1\u0302');
  s = s.replace(/\\bar\{([^}])\}/g, '$1\u0304');
  s = s.replace(/\\dot\{([^}])\}/g, '$1\u0307');
  s = s.replace(/\\ddot\{([^}])\}/g, '$1\u0308');
  s = s.replace(/\\tilde\{([^}])\}/g, '$1\u0303');
  s = s.replace(/\\vec\{([^}])\}/g, '$1\u20D7');
  s = s.replace(/\\overline\{([^}]*)\}/g, '$1\u0305');
  s = s.replace(/\\underline\{([^}]*)\}/g, '$1');
  s = s.replace(/\\overbrace\{([^}]*)\}/g, '$1');
  s = s.replace(/\\underbrace\{([^}]*)\}/g, '$1');
  s = s.replace(/\\widehat\{([^}]*)\}/g, '$1\u0302');
  s = s.replace(/\\widetilde\{([^}]*)\}/g, '$1\u0303');

  // ── Environments (best-effort) ──────────────────────────────────────
  s = s.replace(/\\begin\{(?:equation|align|gather|multline|displaymath|math)\*?\}([\s\S]*?)\\end\{(?:equation|align|gather|multline|displaymath|math)\*?\}/g, '$1');
  s = s.replace(/\\begin\{(?:cases|pmatrix|bmatrix|vmatrix|Vmatrix|matrix)\}([\s\S]*?)\\end\{(?:cases|pmatrix|bmatrix|vmatrix|Vmatrix|matrix)\}/g, (_, body) => {
    return body.replace(/\\\\/g, '\n').replace(/&/g, '  ');
  });
  s = s.replace(/\\\\/g, '\n');
  s = s.replace(/&/g, '  ');

  // ── Cleanup leftover braces and backslashes ─────────────────────────
  // Remove braces used purely for grouping: {x} → x
  s = s.replace(/\{([^{}]*)\}/g, '$1');
  // One more pass for nested
  s = s.replace(/\{([^{}]*)\}/g, '$1');
  // Remove any remaining backslash-commands we didn't handle (e.g. \color{})
  s = s.replace(/\\[a-zA-Z]+/g, '');
  // Collapse multiple spaces
  s = s.replace(/ {2,}/g, ' ');

  return s.trim();
}

type Segment = { code: boolean; text: string };

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;

/**
 * Split markdown into code (``` / ~~~ fences and `inline` spans) and prose
 * segments, so math conversion never touches code: `$HOME`, `x_1` and `$$`
 * in a shell snippet must survive verbatim (and copy verbatim).
 */
export function splitCodeSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const push = (code: boolean, text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.code === code) last.text += text;
    else segments.push({ code, text });
  };

  // Pass 1: fenced blocks, line by line. An unclosed fence runs to the end.
  const lines = content.split('\n');
  let prose = '';
  let fence = '';
  let fenceMarker: string | null = null;
  lines.forEach((line, i) => {
    const text = i < lines.length - 1 ? `${line}\n` : line;
    if (fenceMarker === null) {
      const open = line.match(FENCE_OPEN);
      if (open) {
        splitInlineCode(prose, push);
        prose = '';
        fenceMarker = open[1];
        fence = text;
      } else {
        prose += text;
      }
      return;
    }
    fence += text;
    const trimmed = line.trim();
    if (trimmed.startsWith(fenceMarker[0]) && /^(`{3,}|~{3,})$/.test(trimmed) && trimmed.length >= fenceMarker.length) {
      push(true, fence);
      fence = '';
      fenceMarker = null;
    }
  });
  if (fenceMarker !== null) push(true, fence);
  splitInlineCode(prose, push);
  return segments;
}

/** Pass 2: `inline` code spans — a run of N backticks closed by exactly N. */
function splitInlineCode(text: string, push: (code: boolean, text: string) => void) {
  let i = 0;
  let proseStart = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let runEnd = i;
    while (text[runEnd] === '`') runEnd++;
    const runLength = runEnd - i;
    let close = -1;
    let j = runEnd;
    while (j < text.length) {
      if (text[j] !== '`') {
        j++;
        continue;
      }
      let k = j;
      while (text[k] === '`') k++;
      if (k - j === runLength) {
        close = j;
        break;
      }
      j = k;
    }
    if (close === -1) {
      // Unmatched run is literal text.
      i = runEnd;
      continue;
    }
    push(false, text.slice(proseStart, i));
    push(true, text.slice(i, close + runLength));
    i = close + runLength;
    proseStart = i;
  }
  push(false, text.slice(proseStart));
}

function convertProseMath(text: string): string {
  // Display math → fenced code block (monospace block)
  let result = text.replace(
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g,
    (_, dd, sq) => {
      const raw = (dd || sq || '').trim();
      const converted = latexToUnicode(raw);
      return '\n```\n' + converted + '\n```\n';
    }
  );

  // Inline math → backtick code span (keeps text flow). Pandoc's rule for
  // $…$: the opening $ is not followed by whitespace or a digit, and the
  // closing $ is not preceded by whitespace nor followed by a digit — so
  // "costs $5 and $10" and "$HOME and $PATH" stay plain text.
  result = result.replace(
    /\\\(([^)]+?)\\\)|\$(?![\s\d$])([^$\n]*?[^\s$\\])\$(?!\d)/g,
    (_, paren, dollar) => {
      const raw = (paren || dollar || '').trim();
      const converted = latexToUnicode(raw);
      return '`' + converted + '`';
    }
  );

  return result;
}

/**
 * Pre-process a content string: convert all LaTeX math delimiters
 * to Unicode text inline, preserving paragraph flow. Code (fenced blocks
 * and inline spans) is passed through untouched.
 *
 * Display math ($$...$$ or \[...\]) → fenced code block (monospace block)
 * Inline math ($...$ or \(...\))    → backtick inline code
 */
export function preprocessMath(content: string): string {
  const needsMath = /[$\\]/.test(content);
  const needsBreaks = /<br\s*\/?>/i.test(content);
  if (!needsMath && !needsBreaks) return content;
  return splitCodeSegments(content)
    .map(seg => {
      if (seg.code) return seg.text;
      const text = needsBreaks ? convertHtmlBreaks(seg.text) : seg.text;
      return needsMath ? convertProseMath(text) : text;
    })
    .join('');
}

/**
 * Small models often emit HTML <br> inside markdown (notably in table
 * cells), which the markdown renderer would show literally. Table rows can't
 * hold line breaks, so there it becomes a separator; elsewhere a newline.
 */
export function convertHtmlBreaks(text: string): string {
  return text
    .split('\n')
    .map(line => (/^\s*\|/.test(line)
      ? line
        .replace(/\s*<br\s*\/?>\s*(?=[•*-]\s)/gi, ' ')
        .replace(/\s*<br\s*\/?>\s*/gi, ' · ')
      : line.replace(/<br\s*\/?>/gi, '\n')))
    .join('\n');
}
