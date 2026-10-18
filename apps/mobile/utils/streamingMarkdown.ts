// Repairs in-progress markdown so it renders styled while streaming instead
// of showing raw markers (e.g. "**Bold" renders bold immediately rather than
// showing asterisks until the closing marker arrives).

/**
 * Balance unclosed markdown constructs in streaming text.
 *
 * - Unclosed ``` fence → closed (and inline balancing skipped: we're in code)
 * - Unclosed inline `code`, **bold**, *italic*, ~~strike~~, $$math$$ → closed
 * - A dangling link tail "[label](url-in-progress" → just "label"
 *
 * `cursor`, if given, is placed at the end of the visible text — inside a
 * still-open fence (before the synthetic closing ```), never after it.
 */
export function sanitizeStreamingMarkdown(text: string, cursor: string = ''): string {
  if (!text) return cursor;

  let result = text;

  // Code fences first: if we are inside an unclosed fence, close it and do
  // no inline balancing — the fence content is code, not markdown.
  const fenceCount = (result.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    // Still on the opening line? Keep the cursor out of the info string.
    const onOpeningLine = /(?:^|\n)[ \t]*```[^\n]*$/.test(result);
    const body = cursor && onOpeningLine ? `${result}\n${cursor}` : `${result}${cursor}`;
    return `${body}\n\`\`\``;
  }

  // Dangling image/link at the tail: "[label](partial-url" or "![alt](partial"
  result = result.replace(/!\[[^\]]*\]\([^)]*$/, '');
  result = result.replace(/\[([^\]]*)\]\([^)]*$/, '$1');

  // Display math: odd number of $$ delimiters → close so the math converter
  // can render the partial formula.
  const displayMath = (result.match(/\$\$/g) || []).length;
  if (displayMath % 2 === 1) {
    result = `${result}$$`;
  }

  // Inline code spans (count backticks outside fences — fences are balanced
  // by the time we get here, and each fence contributes a multiple of 3).
  const backticks = (result.match(/`/g) || []).length - fenceCount * 3;
  if (backticks % 2 === 1) {
    result = `${result}\``;
  }

  // Bold: odd number of ** pairs → close.
  const boldMarkers = (result.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 === 1) {
    result = `${result}**`;
  }

  // Italic: single asterisks left over once bold pairs and list bullets
  // ("* item" at line start) are accounted for.
  const totalAsterisks = (result.match(/\*/g) || []).length;
  const bulletAsterisks = (result.match(/(?:^|\n)[ \t]*\*[ \t]/g) || []).length;
  const singles = totalAsterisks - ((result.match(/\*\*/g) || []).length * 2) - bulletAsterisks;
  if (singles % 2 === 1) {
    result = `${result}*`;
  }

  // Strikethrough
  const strikeMarkers = (result.match(/~~/g) || []).length;
  if (strikeMarkers % 2 === 1) {
    result = `${result}~~`;
  }

  if (!cursor) return result;
  // A cursor glued to a closing fence line would turn it into an info string
  // and re-open the block; put it on its own line instead.
  return /(?:^|\n)[ \t]*```[ \t]*$/.test(result) ? `${result}\n${cursor}` : `${result}${cursor}`;
}

/**
 * Split streaming text into blocks that are already complete and a trailing
 * block that is still being written, so the UI can render completed blocks
 * once (memoized) and only re-parse the tail on each tick.
 *
 * A boundary is a blank line followed by an unindented line, outside code
 * fences and $$ display math. Unindented is required so list-item
 * continuations and indented code are never cut away from their parent.
 * Boundaries depend only on text before them, so a completed block's string
 * never changes as more text streams in.
 */
export function splitStreamingBlocks(text: string): { blocks: string[]; tail: string } {
  const blocks: string[] = [];
  const lines = text.split('\n');
  let blockStart = 0; // char offset where the current block begins
  let offset = 0;
  let fenceMarker: string | null = null;
  let mathOpen = false;
  let prevBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      fenceMarker === null &&
      !mathOpen &&
      prevBlank &&
      line.length > 0 &&
      !/^\s/.test(line) &&
      offset > blockStart
    ) {
      blocks.push(text.slice(blockStart, offset));
      blockStart = offset;
    }

    const fence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (fenceMarker === null) {
      if (fence) {
        fenceMarker = fence[1];
      } else {
        const dollars = (line.match(/\$\$/g) || []).length;
        if (dollars % 2 === 1) mathOpen = !mathOpen;
      }
    } else if (fence && fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length && line.trim() === fence[1]) {
      fenceMarker = null;
    }

    prevBlank = line.trim() === '';
    offset += line.length + 1;
  }

  return { blocks, tail: text.slice(blockStart) };
}

/**
 * Hide a partially-typed <think> / </think> (or Mistral [THINK] / [/THINK])
 * tag at the end of streaming text so the tag never flashes as literal
 * characters while it is being revealed character by character.
 */
export function stripPartialThinkTag(text: string): string {
  return text
    .replace(/<\/?(?:t(?:h(?:i(?:n(?:k>?)?)?)?)?)?$/i, '')
    .replace(/\[\/?(?:T(?:H(?:I(?:N(?:K\]?)?)?)?)?)?$/, '');
}
