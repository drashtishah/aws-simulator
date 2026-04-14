// ES module: collapsible blocks and mermaid rendering.
// No DOM globals at import time; all DOM access is inside exported functions.

declare const mermaid: {
  initialize(opts: { startOnLoad: boolean; theme: string }): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

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
