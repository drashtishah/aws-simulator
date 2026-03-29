/* Lightweight markdown renderer for chat messages.
   Handles: bold, italic, inline code, code blocks, headers, hr, lists.
   XSS-safe: escapes HTML before applying markdown transforms. */

(function (exports) {
  'use strict';

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderInline(line) {
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return line;
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const output = [];
    let inCodeBlock = false;
    let codeBlockLines = [];
    let inList = null;

    function closeList() {
      if (inList) {
        output.push('</' + inList + '>');
        inList = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      if (raw.trimEnd().startsWith('```')) {
        if (inCodeBlock) {
          output.push('<pre><code>' + codeBlockLines.join('\n') + '</code></pre>');
          codeBlockLines = [];
          inCodeBlock = false;
        } else {
          closeList();
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(escapeHtml(raw));
        continue;
      }

      const line = escapeHtml(raw);

      if (/^---+$/.test(line.trim())) {
        closeList();
        output.push('<hr>');
        continue;
      }

      if (line.startsWith('### ')) {
        closeList();
        output.push('<h3>' + renderInline(line.slice(4)) + '</h3>');
        continue;
      }
      if (line.startsWith('## ')) {
        closeList();
        output.push('<h2>' + renderInline(line.slice(3)) + '</h2>');
        continue;
      }
      if (line.startsWith('# ')) {
        closeList();
        output.push('<h1>' + renderInline(line.slice(2)) + '</h1>');
        continue;
      }

      if (/^[-*] /.test(line)) {
        if (inList !== 'ul') {
          closeList();
          inList = 'ul';
          output.push('<ul>');
        }
        output.push('<li>' + renderInline(line.replace(/^[-*] /, '')) + '</li>');
        continue;
      }

      if (/^\d+\. /.test(line)) {
        if (inList !== 'ol') {
          closeList();
          inList = 'ol';
          output.push('<ol>');
        }
        output.push('<li>' + renderInline(line.replace(/^\d+\. /, '')) + '</li>');
        continue;
      }

      if (!line.trim()) {
        closeList();
        continue;
      }

      closeList();
      output.push('<p>' + renderInline(line) + '</p>');
    }

    if (inCodeBlock && codeBlockLines.length) {
      output.push('<pre><code>' + codeBlockLines.join('\n') + '</code></pre>');
    }
    closeList();

    return output.join('\n');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderMarkdown };
  } else {
    exports.renderMarkdown = renderMarkdown;
  }
})(typeof window !== 'undefined' ? window : this);
