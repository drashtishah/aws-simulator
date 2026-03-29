/* AWS Incident Simulator - Frontend Application */

(function () {
  'use strict';

  // --- State ---
  let currentView = 'dashboard';
  let currentSessionId = null;
  let currentSimId = null;
  let registry = { sims: [] };
  let profile = { current_level: 1, strengths: [], weaknesses: [] };
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
    try {
      profile = await fetchJSON('/api/profile');
    } catch {
      profile = { current_level: 1, strengths: [], weaknesses: [], completed_sims: [] };
    }

    document.getElementById('stat-level').textContent = profile.current_level || 1;
    const completed = (profile.completed_sims || []).length;
    document.getElementById('stat-completed').textContent = completed;

    // Strengths and weaknesses
    const skillsSection = document.getElementById('section-skills');
    const skillsContent = document.getElementById('skills-content');
    const strengths = profile.strengths || [];
    const weaknesses = profile.weaknesses || [];

    if (strengths.length || weaknesses.length) {
      skillsSection.style.display = 'block';
      let html = '';
      if (strengths.length) {
        html += '<div style="margin-bottom: 8px;"><span class="label">Strengths:</span> <div class="skill-tags" style="display: inline-flex;">';
        html += strengths.map(s => '<span class="skill-tag">' + escapeHtml(s) + '</span>').join('');
        html += '</div></div>';
      }
      if (weaknesses.length) {
        html += '<div><span class="label">Weaknesses:</span> <div class="skill-tags" style="display: inline-flex;">';
        html += weaknesses.map(s => '<span class="skill-tag">' + escapeHtml(s) + '</span>').join('');
        html += '</div></div>';
      }
      skillsContent.innerHTML = html;
    } else {
      skillsSection.style.display = 'none';
    }

    // Journal summary
    try {
      const journal = await fetchJSON('/api/journal-summary');
      const journalSection = document.getElementById('section-journal');
      const journalContent = document.getElementById('journal-content');

      if (journal.length) {
        journalSection.style.display = 'block';
        journalContent.innerHTML = journal.map(entry =>
          '<div class="journal-entry">' +
          '<div class="journal-date">' + escapeHtml(entry.date) + '</div>' +
          '<div class="journal-title">' + escapeHtml(entry.title) + '</div>' +
          (entry.takeaway ? '<div class="journal-takeaway">"' + escapeHtml(entry.takeaway) + '"</div>' : '') +
          '</div>'
        ).join('');
      } else {
        journalSection.style.display = 'none';
      }
    } catch {
      document.getElementById('section-journal').style.display = 'none';
    }

    // Resume banner
    try {
      const sessions = await fetchJSON('/api/sessions');
      const banner = document.getElementById('resume-banner');
      const inProgress = sessions.find(s => s.status === 'in_progress');

      if (inProgress) {
        banner.style.display = 'flex';
        document.getElementById('resume-title').textContent = 'In progress: ' + (inProgress.sim_id || '');
        const criteria = inProgress.criteria_met || [];
        const total = criteria.length + (inProgress.criteria_remaining || []).length;
        document.getElementById('resume-detail').textContent =
          criteria.length + ' of ' + total + ' criteria met.';

        document.getElementById('btn-resume').onclick = () => {
          currentSimId = inProgress.sim_id;
          switchView('play');
          startSim(inProgress.sim_id, true);
        };
      } else {
        banner.style.display = 'none';
      }
    } catch {
      document.getElementById('resume-banner').style.display = 'none';
    }
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

    // Sort: weakness-targeting first
    const weaknesses = (profile.weaknesses || []).map(w => w.toLowerCase());
    const sorted = [...sims].sort((a, b) => {
      const aWeak = (a.services || []).some(s => weaknesses.includes(s.toLowerCase()));
      const bWeak = (b.services || []).some(s => weaknesses.includes(s.toLowerCase()));
      if (aWeak && !bWeak) return -1;
      if (!aWeak && bWeak) return 1;
      return 0;
    });

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
      '<button class="chat-back" id="btn-back-complete">Back to sims</button>';
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
    div.textContent = content;
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
