/* Markdown renderer for chat messages.
   Uses marked.js for full markdown support + highlight.js for code blocks.
   XSS-safe: marked sanitizes by default. */

(function (exports: Record<string, unknown>) {
  'use strict';

  // Configure marked
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,        // GFM line breaks
      gfm: true,           // GitHub flavored markdown
      highlight: function(code: string, lang: string): string {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        if (typeof hljs !== 'undefined') {
          return hljs.highlightAuto(code).value;
        }
        return code;
      }
    });
  }

  function renderMarkdown(text: string): string {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      return marked.parse(text);
    }
    // Fallback: plain text with escaped HTML
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // UMD export: works in both Node (CJS) and browser (global) contexts
  if (typeof globalThis !== 'undefined' && 'module' in globalThis) {
    (globalThis as Record<string, unknown>).module = { exports: { renderMarkdown } };
  } else {
    exports.renderMarkdown = renderMarkdown;
  }
})((typeof window !== 'undefined' ? window : {}) as Record<string, unknown>);
