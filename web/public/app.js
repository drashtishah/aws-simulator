/* AWS Incident Simulator - Frontend Application */

(function () {
  'use strict';

  // --- State ---
  let currentView = 'dashboard';
  let currentSessionId = null;
  let currentSimId = null;
  let registry = { sims: [] };
  let profile = { current_level: 1, completed_sims: [] };
  let narrativeThemes = [];
  let isScrollPinned = true;

  // --- Settings (localStorage with fallback) ---

  function getSetting(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function setSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private browsing or quota exceeded
    }
  }

  // --- Theme Loading ---

  function loadUiTheme(themeId) {
    const link = document.getElementById('ui-theme');
    if (link) {
      link.href = '/ui-themes/' + themeId + '.css';
    }
  }

  // --- API Helpers ---

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch ' + url);
    return res.json();
  }

  // --- SSE Stream Consumer ---

  async function streamResponse(response, handlers) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (handlers[data.type]) {
              handlers[data.type](data);
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    }
  }

  // --- View Management ---

  function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');

    document.querySelectorAll('[role="tab"]').forEach(tab => {
      tab.setAttribute('aria-selected', tab.dataset.view === view ? 'true' : 'false');
    });

    if (view === 'dashboard') {
      loadDashboard();
    } else if (view === 'play') {
      loadSimPicker();
    }
  }

  // --- Dashboard ---

  async function loadDashboard() {
    let progress;
    try {
      progress = await fetchJSON('/api/progress');
    } catch {
      progress = {
        rank: 'Pager Duty Intern',
        rankTitle: 'Pager Duty Intern',
        hexagon: { gather: 0, diagnose: 0, correlate: 0, impact: 0, trace: 0, fix: 0 },
        simsCompleted: 0,
        servicesEncountered: []
      };
    }

    document.getElementById('stat-rank-title').textContent = progress.rankTitle;
    document.getElementById('stat-completed').textContent = progress.simsCompleted;

    // Hexagon SVG
    renderHexagon(progress.hexagon);

    // Services encountered
    const servicesList = document.getElementById('services-list');
    if (progress.servicesEncountered.length) {
      servicesList.innerHTML = progress.servicesEncountered.map(name =>
        '<span class="service-encountered-tag">' + escapeHtml(name) + '</span>'
      ).join('');
    } else {
      servicesList.innerHTML = '<span class="text-muted">No services encountered yet. Play a simulation to begin.</span>';
    }
  }

  function renderHexagon(hexagon) {
    const svg = document.getElementById('hexagon-svg');
    const cx = 150, cy = 150, radius = 110;
    const types = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
    const labels = ['Gather', 'Diagnose', 'Correlate', 'Impact', 'Trace', 'Fix'];

    // Calculate points for each axis
    function getPoint(index, value, maxVal) {
      const angle = (Math.PI * 2 * index / 6) - Math.PI / 2;
      const r = (value / maxVal) * radius;
      return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle)
      };
    }

    // Build SVG content
    let svgContent = '';

    // Background grid rings (at 25%, 50%, 75%, 100%)
    for (const pct of [0.25, 0.5, 0.75, 1.0]) {
      const points = [];
      for (let i = 0; i < 6; i++) {
        const p = getPoint(i, pct * 10, 10);
        points.push(p.x + ',' + p.y);
      }
      svgContent += '<polygon points="' + points.join(' ') + '" class="hexagon-grid-ring" />';
    }

    // Axis lines
    for (let i = 0; i < 6; i++) {
      const p = getPoint(i, 10, 10);
      svgContent += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" class="hexagon-axis-line" />';
    }

    // Data polygon
    const dataPoints = [];
    for (let i = 0; i < 6; i++) {
      const val = hexagon[types[i]] || 0;
      const p = getPoint(i, val, 10);
      dataPoints.push(p.x + ',' + p.y);
    }
    svgContent += '<polygon points="' + dataPoints.join(' ') + '" class="hexagon-polygon" />';

    // Data points (dots)
    for (let i = 0; i < 6; i++) {
      const val = hexagon[types[i]] || 0;
      const p = getPoint(i, val, 10);
      svgContent += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" class="hexagon-dot" />';
    }

    // Labels
    for (let i = 0; i < 6; i++) {
      const p = getPoint(i, 12, 10);
      const anchor = p.x < cx - 5 ? 'end' : p.x > cx + 5 ? 'start' : 'middle';
      const dy = p.y < cy ? '-4' : p.y > cy ? '12' : '4';
      svgContent += '<text x="' + p.x + '" y="' + p.y + '" dy="' + dy + '" text-anchor="' + anchor + '" class="hexagon-label">' + labels[i] + '</text>';
    }

    svg.innerHTML = svgContent;
  }

  // --- Sim Picker ---

  async function loadSimPicker() {
    try {
      registry = await fetchJSON('/api/registry');
    } catch {
      registry = { sims: [] };
    }

    let inProgressIds = [];
    try {
      const sessions = await fetchJSON('/api/sessions');
      inProgressIds = sessions.filter(s => s.status === 'in_progress').map(s => s.sim_id);
    } catch {
      // ignore
    }

    const grid = document.getElementById('sim-grid');
    const empty = document.getElementById('sim-empty');
    const picker = document.getElementById('sim-picker');
    const chat = document.getElementById('chat');

    // If there is an active chat, keep showing it
    if (currentSessionId) {
      picker.style.display = 'none';
      chat.classList.add('active');
      return;
    }

    picker.style.display = 'block';
    chat.classList.remove('active');

    const sims = registry.sims || [];

    if (!sims.length) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    const sorted = [...sims];

    const completedSims = (profile.completed_sims || []);

    grid.innerHTML = sorted.map(sim => {
      const maxDiff = 3;
      const dots = Array.from({ length: maxDiff }, (_, i) =>
        '<span class="difficulty-dot' + (i >= (sim.difficulty || 1) ? ' empty' : '') + '"></span>'
      ).join('');

      const services = (sim.services || []).map(s =>
        '<span class="service-tag">' + escapeHtml(s) + '</span>'
      ).join('');

      const done = completedSims.includes(sim.id);
      const inProgress = inProgressIds.includes(sim.id);
      const statusClass = done ? 'sim-completed' : inProgress ? 'sim-in-progress' : 'sim-new';

      return '<div class="sim-card fade-in ' + statusClass + '" tabindex="0" data-sim-id="' + escapeAttr(sim.id) + '" data-category="' + escapeAttr(sim.category || '') + '">' +
        (done ? '<span class="sim-completed-badge">Completed</span>' : '') +
        (inProgress ? '<span class="sim-completed-badge">Resume</span>' : '') +
        '<div class="sim-card-title">' + escapeHtml(sim.title) + '</div>' +
        '<div class="sim-card-meta">' +
        '<div class="difficulty-dots">' + dots + '</div>' +
        '<span class="sim-card-category">' + escapeHtml(sim.category || '') + '</span>' +
        '</div>' +
        '<div class="sim-card-services">' + services + '</div>' +
        '</div>';
    }).join('');

    // Bind click events
    grid.querySelectorAll('.sim-card').forEach(card => {
      card.addEventListener('click', () => startSim(card.dataset.simId, false));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startSim(card.dataset.simId, false);
        }
      });
    });
  }

  // --- Chat ---

  async function startSim(simId, isResume) {
    currentSimId = simId;

    // Find sim title
    const sim = (registry.sims || []).find(s => s.id === simId);
    document.getElementById('chat-sim-title').textContent = sim ? sim.title : simId;

    // Show chat, hide picker
    document.getElementById('sim-picker').style.display = 'none';
    const chat = document.getElementById('chat');
    chat.classList.add('active');

    // Clear messages
    const messages = document.getElementById('chat-messages');
    messages.innerHTML = '';

    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');
    setInputEnabled(false);
    showTyping(true);

    const themeId = getSetting('narrativeTheme', 'still-life');
    const model = getSetting('model', 'sonnet');
    const endpoint = isResume ? '/api/game/resume' : '/api/game/start';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simId, themeId, model })
      });

      await streamResponse(response, {
        session: (data) => {
          currentSessionId = data.sessionId;
        },
        text: (data) => {
          appendMessage('narrator', data.content);
        },
        console: (data) => {
          appendMessage('console', data.content);
        },
        coaching: (data) => {
          appendMessage('coaching', data.content);
        },
        complete: () => {
          handleSessionComplete();
        },
        error: (data) => {
          appendMessage('system', 'Error: ' + (data.message || 'Unknown error'));
        },
        warning: (data) => {
          appendMessage('system', data.message);
        },
        done: () => {
          showTyping(false);
          setInputEnabled(true);
          input.focus();
        }
      });
    } catch (err) {
      showTyping(false);
      appendMessage('system', 'Connection lost. Please try again.');
      setInputEnabled(true);
    }
  }

  async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (!message || !currentSessionId) return;

    // Show player message
    appendMessage('player', message);
    input.value = '';
    input.style.height = 'auto';

    setInputEnabled(false);
    showTyping(true);
    scrollToBottom();

    try {
      const response = await fetch('/api/game/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, message })
      });

      await streamResponse(response, {
        text: (data) => {
          appendMessage('narrator', data.content);
        },
        console: (data) => {
          appendMessage('console', data.content);
        },
        coaching: (data) => {
          appendMessage('coaching', data.content);
        },
        complete: () => {
          handleSessionComplete();
        },
        error: (data) => {
          appendMessage('system', 'Error: ' + (data.message || 'Unknown error'));
        },
        warning: (data) => {
          appendMessage('system', data.message);
        },
        done: () => {
          showTyping(false);
          setInputEnabled(true);
          input.focus();
        }
      });
    } catch (err) {
      showTyping(false);
      appendMessage('system', 'Connection lost. Retrying...');

      // Auto-retry once
      try {
        const retryResponse = await fetch('/api/game/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSessionId, message })
        });
        await streamResponse(retryResponse, {
          text: (data) => appendMessage('narrator', data.content),
          console: (data) => appendMessage('console', data.content),
          coaching: (data) => appendMessage('coaching', data.content),
          complete: () => handleSessionComplete(),
          error: (data) => appendMessage('system', 'Error: ' + (data.message || 'Unknown error')),
          done: () => {
            showTyping(false);
            setInputEnabled(true);
            input.focus();
          }
        });
      } catch {
        showTyping(false);
        appendMessage('system', 'Could not reconnect. Try sending your message again.');
        setInputEnabled(true);
      }
    }
  }

  function handleSessionComplete() {
    appendMessage('system', 'Simulation complete.');

    // Show back-to-sims link and return-to-dashboard button
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message system';
    div.innerHTML = '<button class="btn btn-secondary" id="btn-return-dashboard" style="margin-right: 8px;">Return to Dashboard</button>' +
      '<button class="btn btn-secondary" id="btn-back-complete">Back to sims</button>';
    messages.appendChild(div);
    scrollToBottom();

    div.querySelector('#btn-return-dashboard').addEventListener('click', () => {
      resetChat();
      switchView('dashboard');
    });
    div.querySelector('#btn-back-complete').addEventListener('click', () => {
      resetChat();
      loadSimPicker();
    });

    // Re-fetch profile
    loadDashboard();
    currentSessionId = null;
  }

  async function quitSim() {
    if (!currentSessionId) return;
    if (!confirm('Quit this simulation? Your progress is saved.')) return;

    try {
      await fetch('/api/game/quit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId })
      });
    } catch {
      // ignore quit errors
    }

    resetChat();
    loadSimPicker();
  }

  function resetChat() {
    currentSessionId = null;
    currentSimId = null;
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('chat').classList.remove('active');
    document.getElementById('sim-picker').style.display = 'block';
    showTyping(false);
    setInputEnabled(true);
  }

  // --- Chat UI Helpers ---

  function appendMessage(type, content) {
    if (!content || !content.trim()) return;
    const messages = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-message ' + type + ' fade-in';
    if (type === 'narrator' || type === 'coaching') {
      div.innerHTML = renderMarkdown(content);
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

  function showTyping(show) {
    const indicator = document.getElementById('typing-indicator');
    indicator.classList.toggle('visible', show);
    if (show) scrollToBottom();
  }

  function setInputEnabled(enabled) {
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('btn-send');
    input.disabled = !enabled;
    sendBtn.disabled = !enabled;
  }

  function scrollToBottom() {
    const messages = document.getElementById('chat-messages');
    messages.scrollTop = messages.scrollHeight;
  }

  // --- Scroll Detection ---

  function setupScrollDetection() {
    const messages = document.getElementById('chat-messages');
    messages.addEventListener('scroll', () => {
      const threshold = 50;
      isScrollPinned = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
      if (isScrollPinned) {
        document.getElementById('new-messages-pill').classList.remove('visible');
      }
    });

    document.getElementById('new-messages-pill').addEventListener('click', () => {
      scrollToBottom();
      document.getElementById('new-messages-pill').classList.remove('visible');
    });
  }

  // --- Settings ---

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

    document.addEventListener('click', (e) => {
      if (!el.contains(e.target)) {
        el.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

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

  function formatThemeName(id) {
    return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  // --- Textarea Auto-resize ---

  function setupTextareaResize() {
    const input = document.getElementById('chat-input');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  // --- Escape Helpers ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // --- Event Bindings ---

  function init() {
    // Load UI theme
    const uiTheme = getSetting('uiTheme', 'dracula');
    loadUiTheme(uiTheme);

    // Tab navigation
    document.querySelectorAll('[role="tab"]').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.add('active');
    });

    document.getElementById('btn-close-settings').addEventListener('click', () => {
      document.getElementById('settings-modal').classList.remove('active');
    });

    document.getElementById('settings-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        e.currentTarget.classList.remove('active');
      }
    });

    // Chat controls
    document.getElementById('btn-send').addEventListener('click', sendMessage);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    document.getElementById('btn-quit').addEventListener('click', quitSim);

    document.getElementById('btn-back-to-sims').addEventListener('click', () => {
      if (currentSessionId) {
        quitSim();
      } else {
        resetChat();
        loadSimPicker();
      }
    });

    // Setup helpers
    setupScrollDetection();
    setupTextareaResize();

    // Load initial data
    loadDashboard();
    loadSettings();
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
