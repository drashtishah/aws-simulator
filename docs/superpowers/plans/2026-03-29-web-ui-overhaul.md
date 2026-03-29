# Web UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify and polish the web UI: fix sim card borders, remove time, style dropdowns to match theme, replace "Back to sims" with icon, render markdown in chat, redesign dashboard to show service catalog instead of raw journal/strengths, replace numeric levels with titles, and modularize progress tracking logic.

**Architecture:** Extract progress tracking into `web/lib/progress.js` (service catalog parsing, level titles, sim status). Frontend changes span `app.js`, `index.html`, `style.css`. Markdown rendering via a lightweight inline parser (no external dependency). Dashboard redesigned around service catalog data. Play skill and coaching-patterns updated to remove strengths/weaknesses and use titled levels.

**Tech Stack:** Node.js, Express, vanilla JS, CSS custom properties, Node built-in test runner, Playwright

---

### Task 1: Sim Card Simplification (remove time, simplify borders)

**Files:**
- Modify: `web/public/app.js:227-250`
- Modify: `web/public/style.css:274-317`
- Modify: `web/test/e2e/sim-picker.spec.js`

The sim cards currently show estimated time (e.g., "15 min") and have a colored left border based on category. The user wants:
- Remove the time display
- Simplify borders: border color indicates status only (completed, new, in-progress/resumable)
- Remove the category-based border colors

**Status colors:**
- Completed: `var(--accent-green)` (green, full left border)
- In-progress (resumable): `var(--accent-primary)` (purple, full left border)
- New (not started): `var(--border-subtle)` (subtle, default border)

- [ ] **Step 1: Write the failing E2E test for sim card status borders**

In `web/test/e2e/sim-picker.spec.js`, add tests for the new status-based borders. The test needs to mock the sessions API to test in-progress status.

```javascript
test('completed sim card has green left border', async ({ page }) => {
  const card = page.locator('.sim-card.sim-completed').first();
  await expect(card).toHaveCount(1);
  const borderColor = await card.evaluate(el => getComputedStyle(el).borderLeftColor);
  // Green (#50FA7B) in rgb
  expect(borderColor).toBe('rgb(80, 250, 123)');
});

test('sim card does not display estimated time', async ({ page }) => {
  await expect(page.locator('.sim-card-time')).toHaveCount(0);
});
```

- [ ] **Step 2: Run E2E test to verify it fails**

Run: `npx playwright test web/test/e2e/sim-picker.spec.js --grep "does not display estimated time"`
Expected: FAIL (time elements still exist)

- [ ] **Step 3: Remove time from sim card rendering in app.js**

In `web/public/app.js`, remove the time variable and the time div from the card template. Change lines 237 and 248:

Remove line 237:
```javascript
      const time = sim.estimated_minutes ? sim.estimated_minutes + ' min' : '';
```

Remove from the template (line 248):
```javascript
        (time ? '<div class="sim-card-time">' + escapeHtml(time) + '</div>' : '') +
```

- [ ] **Step 4: Add status-based border logic in app.js**

The card generation needs to know about in-progress sessions to set border status. Fetch sessions and determine status per card.

In `loadSimPicker()`, after fetching registry (line 185), also fetch sessions:

```javascript
    let inProgressIds = [];
    try {
      const sessions = await fetchJSON('/api/sessions');
      inProgressIds = sessions.filter(s => s.status === 'in_progress').map(s => s.sim_id);
    } catch {
      // ignore
    }
```

Then in the card template (around line 240), add a data attribute for status:

```javascript
      const done = completedSims.includes(sim.id);
      const inProgress = inProgressIds.includes(sim.id);
      const statusClass = done ? 'sim-completed' : inProgress ? 'sim-in-progress' : 'sim-new';
```

Update the card div to use `statusClass` instead of the conditional:

```javascript
      return '<div class="sim-card fade-in ' + statusClass + '" tabindex="0" data-sim-id="' + escapeAttr(sim.id) + '" data-category="' + escapeAttr(sim.category || '') + '">' +
        (done ? '<span class="sim-completed-badge">Completed</span>' : '') +
        (inProgress ? '<span class="sim-completed-badge">Resume</span>' : '') +
```

- [ ] **Step 5: Replace category-based borders with status-based borders in CSS**

In `web/public/style.css`, replace the category border rules (lines 309-317) with status-based borders:

Remove all `.sim-card[data-category="*"]` rules (lines 309-317).

Replace the `.sim-card` border-left (line 279) and add status classes:

```css
.sim-card {
  /* ... existing styles ... */
  border-left: 3px solid var(--border-subtle);
  /* remove: border-left: 3px solid var(--border); */
}

.sim-card.sim-completed {
  border-left-color: var(--accent-green);
}

.sim-card.sim-in-progress {
  border-left-color: var(--accent-primary);
}
```

Keep `.sim-card.sim-completed { filter: saturate(0.4); }` (line 286) as is.

Also remove `.sim-card-time` styles (lines 372-375).

- [ ] **Step 6: Run tests to verify**

Run: `npm test && npx playwright test web/test/e2e/sim-picker.spec.js`
Expected: PASS (time removed, borders by status)

- [ ] **Step 7: Commit**

```bash
git add web/public/app.js web/public/style.css web/test/e2e/sim-picker.spec.js
git commit -m "feat: simplify sim card borders to status-based, remove time display"
```

---

### Task 2: Custom Styled Dropdowns in Settings Modal

**Files:**
- Modify: `web/public/index.html:106-128`
- Modify: `web/public/style.css:601-660`
- Modify: `web/public/app.js:519-546`
- Modify: `web/public/ui-themes/dracula.css`
- Modify: `web/test/e2e/settings.spec.js`

The native `<select>` elements look ugly and don't follow the Dracula theme. Replace them with custom dropdown components that use `<div>` elements styled to match the theme.

- [ ] **Step 1: Write failing E2E test for custom dropdown**

In `web/test/e2e/settings.spec.js`, add a test for the custom dropdown:

```javascript
test('settings dropdowns use custom styled components, not native select', async ({ page }) => {
  await page.click('#btn-settings');
  // No native selects should be visible
  const nativeSelects = page.locator('.modal select');
  await expect(nativeSelects).toHaveCount(0);
  // Custom dropdowns should exist
  const customDropdowns = page.locator('.modal .custom-select');
  await expect(customDropdowns).toHaveCount(3);
});

test('custom dropdown opens and selects option', async ({ page }) => {
  await page.click('#btn-settings');
  const dropdown = page.locator('.custom-select').first();
  await dropdown.click();
  await expect(dropdown.locator('.custom-select-options')).toBeVisible();
  const option = dropdown.locator('.custom-select-option').first();
  await option.click();
  await expect(dropdown.locator('.custom-select-options')).not.toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test web/test/e2e/settings.spec.js --grep "custom styled"`
Expected: FAIL

- [ ] **Step 3: Replace native selects with custom dropdown HTML**

In `web/public/index.html`, replace each `<select>` with a custom dropdown structure. Replace lines 110-125:

```html
      <div class="modal-field">
        <label>UI Color Theme</label>
        <div class="custom-select" id="select-ui-theme" data-setting="uiTheme">
          <div class="custom-select-trigger" tabindex="0" role="combobox" aria-expanded="false" aria-label="UI Color Theme"></div>
          <div class="custom-select-options" role="listbox"></div>
        </div>
      </div>
      <div class="modal-field">
        <label>Narrative Voice</label>
        <div class="custom-select" id="select-narrative-theme" data-setting="narrativeTheme">
          <div class="custom-select-trigger" tabindex="0" role="combobox" aria-expanded="false" aria-label="Narrative Voice"></div>
          <div class="custom-select-options" role="listbox"></div>
        </div>
      </div>
      <div class="modal-field">
        <label>Model</label>
        <div class="custom-select" id="select-model" data-setting="model">
          <div class="custom-select-trigger" tabindex="0" role="combobox" aria-expanded="false" aria-label="Model"></div>
          <div class="custom-select-options" role="listbox"></div>
        </div>
      </div>
```

- [ ] **Step 4: Add custom dropdown CSS**

In `web/public/style.css`, replace the `.modal-field select` rule (lines 644-654) with custom dropdown styles:

```css
.custom-select {
  position: relative;
  width: 100%;
}

.custom-select-trigger {
  width: 100%;
  height: 40px;
  padding: 0 36px 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  user-select: none;
}

.custom-select-trigger::after {
  content: '';
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  border: 5px solid transparent;
  border-top-color: var(--text-secondary);
}

.custom-select.open .custom-select-trigger::after {
  border-top-color: transparent;
  border-bottom-color: var(--text-secondary);
  transform: translateY(-80%);
}

.custom-select-options {
  display: none;
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: var(--shadow-md);
}

.custom-select.open .custom-select-options {
  display: block;
}

.custom-select-option {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.custom-select-option:hover {
  background: var(--bg-surface);
}

.custom-select-option.selected {
  color: var(--accent-primary);
}
```

- [ ] **Step 5: Add custom dropdown JavaScript in app.js**

Add a `CustomSelect` helper class and update `loadSettings()` and the event bindings. Add before the `loadSettings` function:

```javascript
  // --- Custom Select Component ---

  function initCustomSelect(el, options, currentValue, onChange) {
    const trigger = el.querySelector('.custom-select-trigger');
    const optionsList = el.querySelector('.custom-select-options');

    function render() {
      const current = options.find(o => o.value === currentValue) || options[0];
      if (current) trigger.textContent = current.label;

      optionsList.innerHTML = options.map(o =>
        '<div class="custom-select-option' + (o.value === currentValue ? ' selected' : '') +
        '" data-value="' + escapeAttr(o.value) + '" role="option">' +
        escapeHtml(o.label) + '</div>'
      ).join('');
    }

    trigger.addEventListener('click', () => {
      // Close all other dropdowns
      document.querySelectorAll('.custom-select.open').forEach(s => {
        if (s !== el) s.classList.remove('open');
      });
      el.classList.toggle('open');
      trigger.setAttribute('aria-expanded', el.classList.contains('open'));
    });

    optionsList.addEventListener('click', (e) => {
      const opt = e.target.closest('.custom-select-option');
      if (!opt) return;
      currentValue = opt.dataset.value;
      el.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      render();
      onChange(currentValue);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!el.contains(e.target)) {
        el.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    // Keyboard navigation
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      } else if (e.key === 'Escape') {
        el.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    render();
    return {
      setValue(val) { currentValue = val; render(); }
    };
  }
```

Update `loadSettings()` to use `initCustomSelect`:

```javascript
  async function loadSettings() {
    // UI themes
    try {
      const uiThemes = await fetchJSON('/api/ui-themes');
      const options = uiThemes.map(t => ({ value: t, label: formatThemeName(t) }));
      initCustomSelect(
        document.getElementById('select-ui-theme'),
        options,
        getSetting('uiTheme', 'dracula'),
        (val) => { setSetting('uiTheme', val); loadUiTheme(val); }
      );
    } catch {
      // ignore
    }

    // Narrative themes
    try {
      narrativeThemes = await fetchJSON('/api/themes');
      const options = narrativeThemes.map(t => ({ value: t.id, label: t.name }));
      initCustomSelect(
        document.getElementById('select-narrative-theme'),
        options,
        getSetting('narrativeTheme', 'still-life'),
        (val) => { setSetting('narrativeTheme', val); }
      );
    } catch {
      // ignore
    }

    // Model selector
    const modelOptions = [
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
      { value: 'haiku', label: 'Haiku' }
    ];
    initCustomSelect(
      document.getElementById('select-model'),
      modelOptions,
      getSetting('model', 'sonnet'),
      (val) => { setSetting('model', val); }
    );
  }
```

Remove the old event listeners for `select-ui-theme`, `select-narrative-theme`, and `select-model` from `init()` (lines 601-613).

- [ ] **Step 6: Update existing E2E settings tests for custom dropdowns**

Existing tests reference native `<select>` elements. Update them to work with the custom dropdown (click trigger, click option instead of `selectOption()`).

- [ ] **Step 7: Run all tests**

Run: `npm test && npx playwright test web/test/e2e/settings.spec.js`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add web/public/index.html web/public/app.js web/public/style.css web/test/e2e/settings.spec.js
git commit -m "feat: replace native selects with custom styled dropdowns in settings"
```

---

### Task 3: Replace "Back to sims" Text with Back Arrow Icon

**Files:**
- Modify: `web/public/index.html:78`
- Modify: `web/public/style.css:404-411`
- Modify: `web/test/e2e/chat.spec.js`

Replace the text "Back to sims" with a left-arrow icon. Keep the same `#btn-back-to-sims` id and click behavior.

- [ ] **Step 1: Write failing E2E test**

In `web/test/e2e/chat.spec.js`, update or add:

```javascript
test('back button shows arrow icon, not text', async ({ page }) => {
  // Start a sim to show chat
  // ...
  const backBtn = page.locator('#btn-back-to-sims');
  const text = await backBtn.textContent();
  expect(text.trim()).toBe(''); // No text, just icon
  const svg = backBtn.locator('svg');
  await expect(svg).toHaveCount(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test web/test/e2e/chat.spec.js --grep "back button shows arrow"`
Expected: FAIL

- [ ] **Step 3: Replace "Back to sims" with SVG arrow in HTML**

In `web/public/index.html`, replace line 78:

```html
          <button class="chat-back" id="btn-back-to-sims" aria-label="Back to simulations">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
```

- [ ] **Step 4: Update CSS for the back button**

In `web/public/style.css`, update `.chat-back` (lines 404-411):

```css
.chat-back {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.chat-back:hover {
  color: var(--text-primary);
  background: var(--bg-elevated);
}
```

- [ ] **Step 5: Also update the "Back to sims" button in handleSessionComplete**

In `web/public/app.js`, line 418, the complete handler also creates a "Back to sims" button. Replace:

```javascript
      '<button class="chat-back" id="btn-back-complete">Back to sims</button>';
```

with:

```javascript
      '<button class="btn btn-secondary" id="btn-back-complete">Back to sims</button>';
```

This one stays as text because it is an action button in the completion message, not a navigation icon.

- [ ] **Step 6: Run tests**

Run: `npm test && npx playwright test web/test/e2e/chat.spec.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/public/index.html web/public/style.css web/public/app.js web/test/e2e/chat.spec.js
git commit -m "feat: replace Back to sims text with arrow icon"
```

---

### Task 4: Markdown Rendering in Chat Messages

**Files:**
- Create: `web/public/markdown.js`
- Modify: `web/public/index.html` (add script tag)
- Modify: `web/public/app.js:466-479`
- Modify: `web/public/style.css` (add markdown styles)
- Create: `web/test/markdown.test.js`
- Modify: `web/test/e2e/chat.spec.js`

The chat currently uses `div.textContent = content` (line 471 of app.js), which shows raw markdown. Need a lightweight inline markdown parser that handles: bold, italic, code, code blocks, headers, horizontal rules, and lists. No external dependencies.

- [ ] **Step 1: Write unit tests for the markdown parser**

Create `web/test/markdown.test.js`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// We'll test the parser function directly
// Since it's a browser module, we'll extract the logic for testing

const { renderMarkdown } = require('../public/markdown.js');

describe('renderMarkdown', () => {
  it('renders bold text with double asterisks', () => {
    assert.equal(renderMarkdown('**bold**'), '<p><strong>bold</strong></p>');
  });

  it('renders italic text with single asterisks', () => {
    assert.equal(renderMarkdown('*italic*'), '<p><em>italic</em></p>');
  });

  it('renders inline code with backticks', () => {
    assert.equal(renderMarkdown('use `kubectl`'), '<p>use <code>kubectl</code></p>');
  });

  it('renders code blocks with triple backticks', () => {
    const input = '```\nconst x = 1;\n```';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<pre><code>'));
    assert.ok(output.includes('const x = 1;'));
  });

  it('renders horizontal rules', () => {
    assert.ok(renderMarkdown('---').includes('<hr'));
  });

  it('renders h2 headers', () => {
    assert.ok(renderMarkdown('## Title').includes('<h2>'));
    assert.ok(renderMarkdown('## Title').includes('Title'));
  });

  it('renders h3 headers', () => {
    assert.ok(renderMarkdown('### Subtitle').includes('<h3>'));
  });

  it('renders unordered lists', () => {
    const input = '- item one\n- item two';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<ul>'));
    assert.ok(output.includes('<li>'));
    assert.ok(output.includes('item one'));
  });

  it('escapes HTML entities in text', () => {
    const output = renderMarkdown('use <script> tag');
    assert.ok(!output.includes('<script>'));
    assert.ok(output.includes('&lt;script&gt;'));
  });

  it('handles empty input', () => {
    assert.equal(renderMarkdown(''), '');
  });

  it('handles plain text without markdown', () => {
    assert.equal(renderMarkdown('hello world'), '<p>hello world</p>');
  });

  it('renders numbered lists', () => {
    const input = '1. first\n2. second';
    const output = renderMarkdown(input);
    assert.ok(output.includes('<ol>'));
    assert.ok(output.includes('<li>'));
  });

  it('handles mixed bold and italic', () => {
    const output = renderMarkdown('**bold** and *italic*');
    assert.ok(output.includes('<strong>bold</strong>'));
    assert.ok(output.includes('<em>italic</em>'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/test/markdown.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Create the markdown parser module**

Create `web/public/markdown.js`:

```javascript
/* Lightweight markdown renderer for chat messages.
   Handles: bold, italic, inline code, code blocks, headers, hr, lists.
   XSS-safe: escapes HTML before applying markdown transforms. */

(function (exports) {
  'use strict';

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderInline(line) {
    // Inline code (must come before bold/italic to avoid conflicts)
    line = line.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    line = line.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return line;
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const lines = text.split('\n');
    const output = [];
    let inCodeBlock = false;
    let codeBlockLines = [];
    let inList = null; // 'ul' or 'ol'

    function closeList() {
      if (inList) {
        output.push('</' + inList + '>');
        inList = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // Code blocks
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

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        closeList();
        output.push('<hr>');
        continue;
      }

      // Headers
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

      // Unordered list
      if (/^[-*] /.test(line)) {
        if (inList !== 'ul') {
          closeList();
          inList = 'ul';
          output.push('<ul>');
        }
        output.push('<li>' + renderInline(line.replace(/^[-*] /, '')) + '</li>');
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(line)) {
        if (inList !== 'ol') {
          closeList();
          inList = 'ol';
          output.push('<ol>');
        }
        output.push('<li>' + renderInline(line.replace(/^\d+\. /, '')) + '</li>');
        continue;
      }

      // Empty line
      if (!line.trim()) {
        closeList();
        continue;
      }

      // Paragraph
      closeList();
      output.push('<p>' + renderInline(line) + '</p>');
    }

    // Close any open blocks
    if (inCodeBlock && codeBlockLines.length) {
      output.push('<pre><code>' + codeBlockLines.join('\n') + '</code></pre>');
    }
    closeList();

    return output.join('\n');
  }

  // Export for both Node.js tests and browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderMarkdown };
  } else {
    exports.renderMarkdown = renderMarkdown;
  }
})(typeof window !== 'undefined' ? window : this);
```

- [ ] **Step 4: Run unit tests to verify parser works**

Run: `node --test web/test/markdown.test.js`
Expected: PASS

- [ ] **Step 5: Add markdown.js script tag to index.html**

In `web/public/index.html`, before the app.js script tag (line 130), add:

```html
  <script src="/markdown.js"></script>
```

- [ ] **Step 6: Use renderMarkdown in appendMessage**

In `web/public/app.js`, update `appendMessage()` (line 466-479). Replace `div.textContent = content` with markdown rendering for narrator and coaching messages:

```javascript
  function appendMessage(type, content) {
    if (!content || !content.trim()) return;
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message ' + type + ' fade-in';

    if (type === 'narrator' || type === 'coaching') {
      div.innerHTML = renderMarkdown(content);
    } else if (type === 'console') {
      div.textContent = content;
    } else {
      div.textContent = content;
    }

    messages.appendChild(div);

    if (isScrollPinned) {
      scrollToBottom();
    } else {
      document.getElementById('new-messages-pill').classList.add('visible');
    }
  }
```

- [ ] **Step 7: Add markdown content styles in CSS**

In `web/public/style.css`, add styles for rendered markdown inside chat messages. Add after the `.chat-message.system` block (after line 477):

```css
/* Markdown content inside chat messages */
.chat-message h1, .chat-message h2, .chat-message h3 {
  margin: 8px 0 4px;
  font-size: 1rem;
}

.chat-message h2 {
  font-size: 1.05rem;
}

.chat-message p {
  margin: 4px 0;
}

.chat-message ul, .chat-message ol {
  margin: 4px 0;
  padding-left: 20px;
}

.chat-message li {
  margin: 2px 0;
}

.chat-message code {
  background: var(--bg-deep);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.85em;
}

.chat-message pre {
  background: var(--bg-deep);
  padding: 8px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
}

.chat-message pre code {
  background: none;
  padding: 0;
}

.chat-message hr {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 8px 0;
}

.chat-message strong {
  font-weight: 600;
}
```

- [ ] **Step 8: Run all tests**

Run: `npm test && npx playwright test web/test/e2e/chat.spec.js`
Expected: PASS (update `npm test` script in package.json to include `web/test/markdown.test.js` if needed, but it already uses `web/test/*.test.js` glob)

- [ ] **Step 9: Commit**

```bash
git add web/public/markdown.js web/public/index.html web/public/app.js web/public/style.css web/test/markdown.test.js
git commit -m "feat: add markdown rendering for narrator and coaching chat messages"
```

---

### Task 5: Progress Tracking Module (modularize levels, remove strengths/weaknesses)

**Files:**
- Create: `web/lib/progress.js`
- Create: `web/test/progress.test.js`
- Modify: `web/server.js:61-68` (use progress module)
- Modify: `learning/profile.json`
- Modify: `.claude/skills/play/SKILL.md`
- Modify: `.claude/skills/play/references/coaching-patterns.md`

Extract progress tracking into a single module. Replace numeric levels with titled ranks. Remove strengths/weaknesses from profile and coaching. The catalog.csv already tracks per-service knowledge, which is the real source of truth.

**Level titles (funny, escalating):**
1. "Pager Duty Intern"
2. "Config Whisperer"
3. "Root Cause Wrangler"
4. "Incident Commander"
5. "Chaos Architect"

- [ ] **Step 1: Write failing tests for the progress module**

Create `web/test/progress.test.js`:

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { levelTitle, parseCatalog, serviceProgress } = require('../lib/progress');

describe('levelTitle', () => {
  it('returns title for level 1', () => {
    assert.equal(levelTitle(1), 'Pager Duty Intern');
  });

  it('returns title for level 3', () => {
    assert.equal(levelTitle(3), 'Root Cause Wrangler');
  });

  it('returns highest known title for levels beyond max', () => {
    assert.equal(levelTitle(99), 'Chaos Architect');
  });

  it('returns level 1 title for zero or negative', () => {
    assert.equal(levelTitle(0), 'Pager Duty Intern');
    assert.equal(levelTitle(-1), 'Pager Duty Intern');
  });
});

describe('parseCatalog', () => {
  it('parses CSV content into service objects', () => {
    const csv = 'service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes\n' +
      'ec2,Amazon EC2,compute,SAA-C03,3,2,2026-03-25,some notes\n' +
      's3,Amazon S3,storage,SAA-C03,0,0,,\n';
    const result = parseCatalog(csv);
    assert.equal(result.length, 2);
    assert.equal(result[0].service, 'ec2');
    assert.equal(result[0].knowledge_score, 3);
    assert.equal(result[0].sims_completed, 2);
    assert.equal(result[1].service, 's3');
    assert.equal(result[1].knowledge_score, 0);
  });

  it('handles empty CSV', () => {
    const result = parseCatalog('service,full_name,category,cert_relevance,knowledge_score,sims_completed,last_practiced,notes\n');
    assert.equal(result.length, 0);
  });
});

describe('serviceProgress', () => {
  it('separates practiced and unpracticed services', () => {
    const catalog = [
      { service: 'ec2', full_name: 'Amazon EC2', category: 'compute', knowledge_score: 3, sims_completed: 2 },
      { service: 's3', full_name: 'Amazon S3', category: 'storage', knowledge_score: 0, sims_completed: 0 },
      { service: 'lambda', full_name: 'AWS Lambda', category: 'serverless', knowledge_score: 6, sims_completed: 5 }
    ];
    const result = serviceProgress(catalog);
    assert.equal(result.practiced.length, 2);
    assert.equal(result.unpracticed.length, 1);
    assert.equal(result.unpracticed[0].service, 's3');
  });

  it('sorts practiced by knowledge_score descending', () => {
    const catalog = [
      { service: 'ec2', full_name: 'Amazon EC2', category: 'compute', knowledge_score: 3, sims_completed: 2 },
      { service: 'lambda', full_name: 'AWS Lambda', category: 'serverless', knowledge_score: 6, sims_completed: 5 }
    ];
    const result = serviceProgress(catalog);
    assert.equal(result.practiced[0].service, 'lambda');
    assert.equal(result.practiced[1].service, 'ec2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/test/progress.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Create the progress module**

Create `web/lib/progress.js`:

```javascript
'use strict';

const LEVEL_TITLES = [
  'Pager Duty Intern',
  'Config Whisperer',
  'Root Cause Wrangler',
  'Incident Commander',
  'Chaos Architect'
];

function levelTitle(level) {
  const idx = Math.max(0, Math.min((level || 1) - 1, LEVEL_TITLES.length - 1));
  return LEVEL_TITLES[idx];
}

function parseCatalog(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  return lines.slice(1).filter(line => line.trim()).map(line => {
    // Handle commas inside notes (last column may contain commas)
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes && values.length < headers.length - 1) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return {
      service: values[0] || '',
      full_name: values[1] || '',
      category: values[2] || '',
      cert_relevance: values[3] || '',
      knowledge_score: parseInt(values[4], 10) || 0,
      sims_completed: parseInt(values[5], 10) || 0,
      last_practiced: values[6] || '',
      notes: values[7] || ''
    };
  });
}

function serviceProgress(catalog) {
  const practiced = catalog
    .filter(s => s.sims_completed > 0)
    .sort((a, b) => b.knowledge_score - a.knowledge_score);
  const unpracticed = catalog.filter(s => s.sims_completed === 0);
  return { practiced, unpracticed };
}

module.exports = { levelTitle, parseCatalog, serviceProgress, LEVEL_TITLES };
```

- [ ] **Step 4: Run tests to verify module works**

Run: `node --test web/test/progress.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/lib/progress.js web/test/progress.test.js
git commit -m "feat: add progress module with level titles and catalog parsing"
```

---

### Task 6: Add Catalog API Endpoint

**Files:**
- Modify: `web/server.js`
- Modify: `web/lib/paths.js`
- Modify: `web/test/server.test.js`

Add a `GET /api/catalog` endpoint that returns parsed catalog data using the progress module.

- [ ] **Step 1: Write failing test for the catalog endpoint**

In `web/test/server.test.js`, add after the journal-summary tests:

```javascript
describe('GET /api/catalog', () => {
  const app = buildApp();

  it('returns array of service objects', async () => {
    const res = await request(app, 'GET', '/api/catalog');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it('each service has required fields', async () => {
    const res = await request(app, 'GET', '/api/catalog');
    if (res.body.length > 0) {
      const svc = res.body[0];
      assert.ok(typeof svc.service === 'string');
      assert.ok(typeof svc.full_name === 'string');
      assert.ok(typeof svc.knowledge_score === 'number');
      assert.ok(typeof svc.sims_completed === 'number');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test web/test/server.test.js`
Expected: FAIL (404)

- [ ] **Step 3: Add paths.CATALOG constant**

In `web/lib/paths.js`, add (check existing content first; may already exist via LEARNING_DIR):

```javascript
const CATALOG = path.join(LEARNING_DIR, 'catalog.csv');
```

Export it alongside existing constants.

- [ ] **Step 4: Add GET /api/catalog endpoint to server.js**

In `web/server.js`, add after the journal-summary endpoint and import progress module:

```javascript
const { parseCatalog } = require('./lib/progress');
```

```javascript
app.get('/api/catalog', (req, res) => {
  try {
    const content = fs.readFileSync(paths.CATALOG, 'utf8');
    const catalog = parseCatalog(content);
    res.json(catalog);
  } catch (err) {
    console.error(`GET /api/catalog: ${err.message}`);
    res.json([]);
  }
});
```

Also add this route to `buildApp()` in `web/test/server.test.js`.

- [ ] **Step 5: Add GET /api/level-title endpoint**

```javascript
const { levelTitle } = require('./lib/progress');

app.get('/api/level-title', (req, res) => {
  const profile = readJSON(paths.PROFILE, { current_level: 1 });
  res.json({ level: profile.current_level, title: levelTitle(profile.current_level) });
});
```

Add corresponding test:

```javascript
describe('GET /api/level-title', () => {
  const app = buildApp();

  it('returns level number and title string', async () => {
    const res = await request(app, 'GET', '/api/level-title');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.level === 'number');
    assert.ok(typeof res.body.title === 'string');
    assert.ok(res.body.title.length > 0);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `node --test web/test/server.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/server.js web/lib/paths.js web/test/server.test.js
git commit -m "feat: add catalog and level-title API endpoints"
```

---

### Task 7: Redesign Dashboard

**Files:**
- Modify: `web/public/index.html:34-63`
- Modify: `web/public/app.js:97-179`
- Modify: `web/public/style.css:152-265`
- Modify: `web/test/e2e/dashboard.spec.js`

Dashboard should show:
1. Level title (not number) + completed count
2. Service catalog summary: which services practiced, which not
3. No strengths/weaknesses section
4. No recent sessions section
5. No resume banner (resume happens from Play view only)

- [ ] **Step 1: Write failing E2E test for new dashboard**

In `web/test/e2e/dashboard.spec.js`, replace or add:

```javascript
test('dashboard shows level title instead of number', async ({ page }) => {
  const levelEl = page.locator('#stat-level-title');
  await expect(levelEl).toBeVisible();
  const text = await levelEl.textContent();
  // Should be a title string, not a raw number
  expect(text).not.toMatch(/^\d+$/);
});

test('dashboard shows service catalog with practiced and unpracticed sections', async ({ page }) => {
  await expect(page.locator('#section-services')).toBeVisible();
  await expect(page.locator('#practiced-services')).toBeVisible();
  await expect(page.locator('#unpracticed-services')).toBeVisible();
});

test('dashboard does not show strengths/weaknesses section', async ({ page }) => {
  await expect(page.locator('#section-skills')).not.toBeVisible();
});

test('dashboard does not show recent sessions section', async ({ page }) => {
  await expect(page.locator('#section-journal')).not.toBeVisible();
});

test('dashboard does not show resume banner', async ({ page }) => {
  await expect(page.locator('#resume-banner')).not.toBeAttached();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test web/test/e2e/dashboard.spec.js --grep "level title"`
Expected: FAIL

- [ ] **Step 3: Update dashboard HTML**

In `web/public/index.html`, replace the dashboard view content (lines 34-63):

```html
    <div id="view-dashboard" class="view active">
      <div class="dashboard-stats" id="dashboard-stats">
        <div class="stat-card">
          <div class="stat-value" id="stat-level-title">Pager Duty Intern</div>
          <div class="stat-label">Rank</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-completed">0</div>
          <div class="stat-label">Completed</div>
        </div>
      </div>

      <div class="dashboard-section" id="section-services">
        <h2>Service Catalog</h2>
        <div id="practiced-services"></div>
        <div id="unpracticed-services" style="margin-top: 16px;"></div>
      </div>
    </div>
```

This removes: resume-banner, section-skills, section-journal, stat-level.

- [ ] **Step 4: Update loadDashboard() in app.js**

Replace `loadDashboard()` (lines 97-179):

```javascript
  async function loadDashboard() {
    try {
      profile = await fetchJSON('/api/profile');
    } catch {
      profile = { current_level: 1, completed_sims: [] };
    }

    // Level title
    try {
      const levelData = await fetchJSON('/api/level-title');
      document.getElementById('stat-level-title').textContent = levelData.title;
    } catch {
      document.getElementById('stat-level-title').textContent = 'Pager Duty Intern';
    }

    // Completed count
    const completed = (profile.completed_sims || []).length;
    document.getElementById('stat-completed').textContent = completed;

    // Service catalog
    try {
      const catalog = await fetchJSON('/api/catalog');
      const practiced = catalog.filter(s => s.sims_completed > 0)
        .sort((a, b) => b.knowledge_score - a.knowledge_score);
      const unpracticed = catalog.filter(s => s.sims_completed === 0);

      const practicedEl = document.getElementById('practiced-services');
      const unpracticedEl = document.getElementById('unpracticed-services');

      if (practiced.length) {
        practicedEl.innerHTML =
          '<div class="label" style="margin-bottom: 8px;">Practiced</div>' +
          '<div class="service-catalog-grid">' +
          practiced.map(s =>
            '<div class="service-catalog-item">' +
            '<span class="service-catalog-name">' + escapeHtml(s.full_name) + '</span>' +
            '<span class="service-catalog-score">' + s.knowledge_score + '</span>' +
            '</div>'
          ).join('') +
          '</div>';
      }

      if (unpracticed.length) {
        unpracticedEl.innerHTML =
          '<div class="label" style="margin-bottom: 8px;">Not yet practiced</div>' +
          '<div class="service-catalog-grid unpracticed">' +
          unpracticed.map(s =>
            '<div class="service-catalog-item muted">' +
            '<span class="service-catalog-name">' + escapeHtml(s.full_name) + '</span>' +
            '</div>'
          ).join('') +
          '</div>';
      }
    } catch {
      // ignore
    }
  }
```

- [ ] **Step 5: Add service catalog CSS styles**

In `web/public/style.css`, add after the dashboard section styles:

```css
.service-catalog-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.service-catalog-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: var(--bg-elevated);
  border-radius: 6px;
  font-size: 0.85rem;
}

.service-catalog-item.muted {
  color: var(--text-muted);
}

.service-catalog-name {
  flex: 1;
}

.service-catalog-score {
  font-weight: 600;
  color: var(--accent-primary);
  font-size: 0.8rem;
  margin-left: 8px;
}
```

Also adjust `.stat-value` for the level title (it may need smaller font since titles are longer than numbers):

```css
.stat-value {
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.3;
}
```

Wait, the existing stat-value is `font-size: 2rem` which works for numbers but would be too big for titles. Change to:

```css
.stat-value {
  font-size: 1.5rem;
  font-weight: 600;
  line-height: 1.2;
}
```

- [ ] **Step 6: Remove old dashboard-related code**

Remove the `init()` references to old elements that no longer exist. Clean up any remaining references to `section-skills`, `section-journal`, `resume-banner` in app.js. Remove the old styles for `.journal-entry`, `.journal-date`, `.journal-title`, `.journal-takeaway`, `.resume-banner`, `.skill-tags`, `.skill-tag` from style.css if no longer used elsewhere.

- [ ] **Step 7: Remove old stat-level from E2E dashboard tests**

Update remaining tests in `web/test/e2e/dashboard.spec.js` that reference `#stat-level`, `#section-skills`, `#section-journal`, or `#resume-banner`.

- [ ] **Step 8: Run tests**

Run: `npm test && npx playwright test web/test/e2e/dashboard.spec.js`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add web/public/index.html web/public/app.js web/public/style.css web/test/e2e/dashboard.spec.js
git commit -m "feat: redesign dashboard with service catalog and level titles"
```

---

### Task 8: Update Play Skill and Coaching Patterns

**Files:**
- Modify: `.claude/skills/play/SKILL.md`
- Modify: `.claude/skills/play/references/coaching-patterns.md`

Remove strengths/weaknesses from the play skill. Replace numeric level display with level title. Keep the underlying level number for sim filtering but display the title.

- [ ] **Step 1: Update coaching-patterns.md to remove strength/weakness detection**

In `.claude/skills/play/references/coaching-patterns.md`, remove the "Weakness Detection" and "Strength Detection" sections (lines 214-230). Replace with a note:

```markdown
### Service Progress

Service-level progress is tracked in `learning/catalog.csv` via knowledge scores (0-8 per service). The play skill updates scores after each sim per the scoring rules above. No separate strengths/weaknesses arrays are maintained.
```

- [ ] **Step 2: Update play.md Step 17 to remove strengths/weaknesses updates**

In `.claude/skills/play/SKILL.md`, in Step 17 (Update Learning Profile), remove the bullet about updating `weaknesses` and `strengths`. Change the level title reference:

Replace:
```
4. **Level progression**: if 2 or more sims completed at `current_level`, add `current_level + 1` to `unlocked_levels` and set `current_level` to `current_level + 1`
5. Update `weaknesses` and `strengths` per coaching-patterns.md rules
```

With:
```
4. **Level progression**: if 2 or more sims completed at `current_level`, add `current_level + 1` to `unlocked_levels` and set `current_level` to `current_level + 1`
```

(Simply remove item 5.)

- [ ] **Step 3: Update play.md Step 4 to not reference weaknesses for sorting**

In Step 4, the skill sorts sims with weakness-targeting sims first based on `profile.weaknesses`. Change this to sort by services with lowest knowledge scores in the catalog:

Replace:
```
Sort eligible sims with weakness-targeting sims first:

1. Sims whose `services` array overlaps with `profile.weaknesses` -- show these first
2. Remaining eligible sims sorted by difficulty ascending
```

With:
```
Sort eligible sims with low-knowledge services first:

1. Read `learning/catalog.csv`. For each eligible sim, sum the knowledge scores of its services. Sims with lowest total score appear first (these cover the services the player knows least).
2. Remaining eligible sims sorted by difficulty ascending.
```

- [ ] **Step 4: Update the default profile in Step 1 to remove strengths/weaknesses**

In Step 1 (Load Learner Profile), remove `weaknesses` and `strengths` from the default profile JSON.

- [ ] **Step 5: Update profile.json to remove strengths/weaknesses**

In `learning/profile.json`, remove the `"weaknesses"` and `"strengths"` fields.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/play/SKILL.md .claude/skills/play/references/coaching-patterns.md learning/profile.json
git commit -m "refactor: remove strengths/weaknesses from progress tracking, simplify to catalog scores"
```

---

### Task 9: Update Sim Picker Sorting (use catalog scores instead of weaknesses)

**Files:**
- Modify: `web/public/app.js:215-223`
- Modify: `web/server.js`

The sim picker in the web app also sorts by weaknesses. Update to sort by lowest catalog knowledge score.

- [ ] **Step 1: Update loadSimPicker to sort by catalog scores**

In `web/public/app.js`, the sorting block (lines 215-223) uses `profile.weaknesses`. Replace:

```javascript
    // Sort: low-knowledge services first
    let catalog = [];
    try {
      catalog = await fetchJSON('/api/catalog');
    } catch {
      // ignore
    }

    const scoreMap = {};
    for (const s of catalog) {
      scoreMap[s.service] = s.knowledge_score;
    }

    const sorted = [...sims].sort((a, b) => {
      const aScore = (a.services || []).reduce((sum, s) => sum + (scoreMap[s.toLowerCase()] || 0), 0);
      const bScore = (b.services || []).reduce((sum, s) => sum + (scoreMap[s.toLowerCase()] || 0), 0);
      if (aScore !== bScore) return aScore - bScore;
      return (a.difficulty || 1) - (b.difficulty || 1);
    });
```

Remove the old `weaknesses` const and sort block.

- [ ] **Step 2: Run tests**

Run: `npm test && npx playwright test web/test/e2e/sim-picker.spec.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add web/public/app.js
git commit -m "refactor: sort sim picker by catalog knowledge scores instead of weaknesses"
```

---

### Task 10: Final Cleanup and Full Test Run

**Files:**
- Modify: `web/test/e2e/dashboard.spec.js` (final cleanup)
- Modify: `web/test/e2e/navigation.spec.js` (if referencing removed elements)
- Modify: `web/test/e2e/visual.spec.js` (update snapshots)
- Modify: `web/test/e2e/accessibility.spec.js` (update ARIA expectations)

- [ ] **Step 1: Search for stale references in E2E tests**

Grep all E2E test files for: `stat-level` (the old number-based one), `section-skills`, `section-journal`, `resume-banner`, `select-ui-theme` (as native select), `Back to sims`, `sim-card-time`. Update or remove any tests referencing these removed elements.

- [ ] **Step 2: Update visual regression baselines**

Delete old snapshot files and regenerate:

```bash
npx playwright test web/test/e2e/visual.spec.js --update-snapshots
```

- [ ] **Step 3: Run the full test suite**

```bash
npm run test:all
```

Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add -A web/test/
git commit -m "test: update E2E tests for dashboard redesign and UI changes"
```

---

### Task 11: Address Feedback (hints tracking)

**Files:**
- Modify: `.claude/skills/play/SKILL.md`

The feedback from 2026-03-27 says hint counting may be unnecessary. The hint counter in session state and journal is confusing. Remove hint counting from the journal entry and coaching output, but keep hints in sim manifests (they are still delivered during play).

- [ ] **Step 1: Update journal entry template in play.md**

In Step 19 (Write Journal Entry), remove `- **Hints used**: {hints_used}` from the template.

- [ ] **Step 2: Remove hint counting from coaching analysis**

In Step 15, coaching analysis should not reference `hints_used` as a metric. The coaching-patterns.md does not have specific rules for hints, so this is mainly about the journal template.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/play/SKILL.md
git commit -m "refactor: remove hint counter from journal, keep hint content in sims"
```
