// ES module: progressive text reveal and collapsible blocks.
// No DOM globals at import time; all DOM access is inside exported functions.

declare const mermaid: {
  initialize(opts: { startOnLoad: boolean; theme: string }): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

declare function renderMarkdown(text: string): string;

/**
 * Splits an HTML string into reveal units (pure string function, no DOM).
 * Returns string[] (not HTMLElements).
 * Units: p, h1-h6, ul, ol, pre (code blocks), div.mermaid-diagram, other block divs.
 * Each is atomic; caller wraps each in a div.reveal-unit.
 */
export function splitIntoRevealUnits(html: string): string[] {
  if (!html || !html.trim()) return [];

  const units: string[] = [];
  let remaining = html;

  // Matches a self-contained top-level block tag (handles nested tags via depth counting).
  const blockTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'div', 'blockquote', 'hr', 'table'];
  const openTagRe = new RegExp('^<(' + blockTags.join('|') + ')(\\s[^>]*)?>');

  while (remaining.length > 0) {
    const trimmed = remaining.trimStart();
    if (!trimmed) break;

    const offset = remaining.length - trimmed.length;
    remaining = trimmed;

    const match = remaining.match(openTagRe);
    if (!match) {
      // Text node or unknown inline: consume to next '<' or end
      const next = remaining.indexOf('<');
      if (next === -1) {
        units.push(remaining.trim());
        remaining = '';
      } else {
        const text = remaining.slice(0, next).trim();
        if (text) units.push(text);
        remaining = remaining.slice(next);
      }
      continue;
    }

    const tag = match[1];
    // Void tags (hr): no closing tag
    if (tag === 'hr') {
      units.push(match[0]);
      remaining = remaining.slice(match[0].length);
      continue;
    }

    // Find the matching closing tag, tracking nesting depth
    let depth = 1;
    let pos = match[0].length;
    const openRe = new RegExp('<' + tag + '(\\s[^>]*)?>');
    const closeRe = new RegExp('</' + tag + '>');

    while (depth > 0 && pos < remaining.length) {
      const sub = remaining.slice(pos);
      const nextOpen = sub.search(openRe);
      const nextClose = sub.search(closeRe);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos += nextOpen + 1;
      } else {
        depth--;
        if (depth === 0) {
          pos += nextClose + ('</' + tag + '>').length;
        } else {
          pos += nextClose + 1;
        }
      }
    }

    units.push(remaining.slice(0, pos));
    remaining = remaining.slice(pos);
  }

  return units.filter(u => u.trim().length > 0);
}

/**
 * Renders markdown into div progressively, one unit at a time.
 * Skips delay when prefers-reduced-motion matches.
 */
export async function revealMarkdownInto(
  div: HTMLElement,
  markdown: string,
  perUnitMs: number
): Promise<void> {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const html = renderMarkdown(markdown);
  const units = splitIntoRevealUnits(html);

  for (const unitHtml of units) {
    const unitDiv = document.createElement('div');
    unitDiv.className = 'reveal-unit';
    unitDiv.innerHTML = unitHtml;
    div.appendChild(unitDiv);
    renderMermaidIn(unitDiv);

    // Scroll after each unit
    const messages = div.closest('#chat-messages');
    if (messages) {
      messages.scrollTop = messages.scrollHeight;
    }

    if (!reduced && perUnitMs > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, perUnitMs));
    }
  }
}

/**
 * Returns a <details> collapsible element.
 */
export function CollapsibleBlock({
  title,
  bodyHtml,
  defaultOpen,
}: {
  title: string;
  bodyHtml: string;
  defaultOpen: boolean;
}): HTMLElement {
  const details = document.createElement('details');
  details.className = 'collapsible-block collapsible-' + title.toLowerCase();
  if (defaultOpen) details.open = true;

  const summary = document.createElement('summary');
  summary.textContent = title;
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'collapsible-body';
  body.innerHTML = bodyHtml;
  details.appendChild(body);

  return details;
}

/**
 * Runs mermaid on any pre code.language-mermaid blocks inside el.
 */
export function renderMermaidIn(el: HTMLElement): void {
  if (typeof mermaid === 'undefined') return;
  const codeBlocks = el.querySelectorAll('pre code.language-mermaid');
  codeBlocks.forEach(async (block: Element, idx: number) => {
    const pre = block.parentElement;
    const id = 'mermaid-' + Date.now() + '-' + idx;
    try {
      const { svg } = await mermaid.render(id, block.textContent || '');
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-diagram';
      wrapper.innerHTML = svg;
      pre?.replaceWith(wrapper);
    } catch { /* leave as code block if mermaid fails */ }
  });
}
