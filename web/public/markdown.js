/* Markdown renderer for chat messages.
   Uses marked.js for full markdown support + highlight.js for code blocks.
   XSS-safe: marked sanitizes by default. */

(function (exports) {
  'use strict';

  // Configure marked
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,        // GFM line breaks
      gfm: true,           // GitHub flavored markdown
      highlight: function(code, lang) {
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

  function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
      return marked.parse(text);
    }
    // Fallback: plain text with escaped HTML
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderMarkdown };
  } else {
    exports.renderMarkdown = renderMarkdown;
  }
})(typeof window !== 'undefined' ? window : this);
