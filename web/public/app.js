/* AWS Incident Simulator - Frontend Application */

(function () {
  'use strict';

  // --- State ---
  let currentView = 'dashboard';
  let currentSessionId = null;
  let currentSimId = null;
  let registry = { sims: [] };
  let profile = { completed_sims: [] };
  let progressData = null;
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
      hideCompletedDrilldown();
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
        rank: 'Responder',
        rankTitle: 'Responder',
        polygon: {},
        rawPolygon: {},
        axisNames: ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'],
        axisLabels: { gather: 'Gather', diagnose: 'Diagnose', correlate: 'Correlate', impact: 'Impact', trace: 'Trace', fix: 'Fix' },
        simsCompleted: 0,
        servicesEncountered: [],
        polygonLastAdvanced: {},
        rankHistory: [],
        challengeRuns: [],
        maxDifficulty: 1,
        assist: {}
      };
    }
    progressData = progress;

    document.getElementById('stat-rank-title').textContent = progress.rankTitle;
    document.getElementById('stat-completed').textContent = progress.simsCompleted;

    // Dynamic polygon SVG
    renderPolygon(progress.polygon, progress.axisNames, progress.axisLabels, progress.polygonLastAdvanced);

    // Next rank preview
    renderNextRank(progress);

    // Rank history
    renderRankProgression(progress.rankHistory || []);

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

  function showCompletedDrilldown() {
    if (!progressData || !progressData.completedSims || !progressData.completedSims.length) return;

    document.getElementById('dashboard-content').style.display = 'none';
    const drilldown = document.getElementById('completed-drilldown');
    drilldown.style.display = 'block';

    const grid = document.getElementById('completed-grid');
    grid.innerHTML = progressData.completedSims.map(sim => {
      const maxDiff = 4;
      const dots = Array.from({ length: maxDiff }, (_, i) =>
        '<span class="difficulty-dot' + (i >= (sim.difficulty || 1) ? ' empty' : '') + '"></span>'
      ).join('');

      const qTypes = (sim.questionTypes || []).map(t =>
        '<span class="question-type-tag">' + escapeHtml(t) + '</span>'
      ).join('');

      const tooltip = sim.summary ? ' data-tooltip="' + escapeAttr(sim.summary) + '"' : '';
      return '<div class="sim-card fade-in"' + tooltip + '>' +
        '<div class="sim-card-title">' + escapeHtml(sim.title) + '</div>' +
        '<div class="sim-card-meta">' +
        '<div class="difficulty-dots">' + dots + '</div>' +
        '<span class="sim-card-category">' + escapeHtml(sim.category || '') + '</span>' +
        '</div>' +
        '<div class="question-type-tags">' + qTypes + '</div>' +
        '</div>';
    }).join('');
  }

  function hideCompletedDrilldown() {
    document.getElementById('completed-drilldown').style.display = 'none';
    document.getElementById('dashboard-content').style.display = 'block';
  }

  function renderPolygon(polygon, axes, axisLabels, polygonLastAdvanced) {
    const svg = document.getElementById('hexagon-svg');
    const cx = 150, cy = 150, radius = 110;
    const n = axes.length;
    if (n === 0) return;

    // Check which axes are fading (> 21 days since last advanced)
    const fadingAxes = new Set();
    if (polygonLastAdvanced) {
      const now = new Date();
      for (const axis of axes) {
        const last = polygonLastAdvanced[axis];
        if (last) {
          const daysSince = (now - new Date(last)) / (1000 * 60 * 60 * 24);
          if (daysSince >= 21) fadingAxes.add(axis);
        }
      }
    }

    function getPoint(index, value, maxVal) {
      const angle = (Math.PI * 2 * index / n) - Math.PI / 2;
      const r = (value / maxVal) * radius;
      return {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle)
      };
    }

    let svgContent = '';

    // Background grid rings
    for (const pct of [0.25, 0.5, 0.75, 1.0]) {
      const points = [];
      for (let i = 0; i < n; i++) {
        const p = getPoint(i, pct * 10, 10);
        points.push(p.x + ',' + p.y);
      }
      svgContent += '<polygon points="' + points.join(' ') + '" class="hexagon-grid-ring" />';
    }

    // Axis lines
    for (let i = 0; i < n; i++) {
      const p = getPoint(i, 10, 10);
      svgContent += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p.x + '" y2="' + p.y + '" class="hexagon-axis-line" />';
    }

    // Data polygon
    const dataPoints = [];
    for (let i = 0; i < n; i++) {
      const val = polygon[axes[i]] || 0;
      const p = getPoint(i, val, 10);
      dataPoints.push(p.x + ',' + p.y);
    }
    svgContent += '<polygon points="' + dataPoints.join(' ') + '" class="hexagon-polygon" />';

    // Data points (dots), with fading indicator
    for (let i = 0; i < n; i++) {
      const axis = axes[i];
      const val = polygon[axis] || 0;
      const p = getPoint(i, val, 10);
      const fadingClass = fadingAxes.has(axis) ? ' hexagon-dot-fading' : '';
      svgContent += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" class="hexagon-dot' + fadingClass + '" />';
    }

    // Axis descriptions: example questions for each type
    const axisDescriptions = {
      gather: 'What do the logs and metrics show?',
      diagnose: 'What is causing this behavior?',
      correlate: 'What else changed around the same time?',
      impact: 'How many users and services are affected?',
      trace: 'Where does the request fail in the chain?',
      fix: 'What would resolve this and how do we verify?'
    };

    // Labels, with fading indicator
    for (let i = 0; i < n; i++) {
      const axis = axes[i];
      const label = (axisLabels && axisLabels[axis]) || axis;
      const p = getPoint(i, 12, 10);
      const anchor = p.x < cx - 5 ? 'end' : p.x > cx + 5 ? 'start' : 'middle';
      const dy = p.y < cy ? '-4' : p.y > cy ? '12' : '4';
      const fadingClass = fadingAxes.has(axis) ? ' hexagon-label-fading' : '';
      svgContent += '<text x="' + p.x + '" y="' + p.y + '" dy="' + dy + '" text-anchor="' + anchor + '" class="hexagon-label' + fadingClass + '">' + escapeHtml(label) + '</text>';
    }

    svg.innerHTML = svgContent;

    // Render interactive hotspots over each label
    const hotspots = document.getElementById('hexagon-hotspots');
    if (hotspots) {
      const svgEl = document.getElementById('hexagon-svg');
      const svgRect = svgEl.getBoundingClientRect();
      const vb = { x: -40, y: -10, w: 380, h: 320 };
      const scaleX = svgRect.width / vb.w;
      const scaleY = svgRect.height / vb.h;

      hotspots.innerHTML = axes.map((axis, i) => {
        const label = (axisLabels && axisLabels[axis]) || axis;
        const desc = axisDescriptions[axis] || '';
        const p = getPoint(i, 12, 10);
        const px = (p.x - vb.x) * scaleX;
        const py = (p.y - vb.y) * scaleY;
        return '<div class="hexagon-hotspot" data-tooltip="' + escapeAttr(desc) + '" style="left:' + px + 'px;top:' + py + 'px;transform:translate(-50%,-50%)">' + escapeHtml(label) + '</div>';
      }).join('');
    }

  }

  // Rank metadata
  var rankMeta = {
    'responder': { description: 'You respond to alerts and follow runbooks.', icon: 'dot' },
    'junior-investigator': { description: 'You ask targeted questions about specific services.', icon: 'dot' },
    'investigator': { description: 'You dig into logs and identify patterns.', icon: 'triangle' },
    'senior-investigator': { description: 'You investigate broadly across multiple services.', icon: 'triangle' },
    'analyst': { description: 'You connect signals across services to find root causes.', icon: 'diamond' },
    'senior-analyst': { description: 'You correlate complex multi-service failures.', icon: 'diamond' },
    'incident-commander': { description: 'You can lead any incident from detection to resolution.', icon: 'shield' },
    'senior-commander': { description: 'You handle cascading failures with precision.', icon: 'shield' },
    'chaos-engineer': { description: 'You understand failure modes deeply enough to create them.', icon: 'star' },
    'chaos-architect': { description: 'You anticipate failures before they happen.', icon: 'star' }
  };

  function renderNextRank(progress) {
    const container = document.getElementById('next-rank-info');
    if (!container) return;

    const nextRank = progress.nextRank;
    if (!nextRank) {
      container.innerHTML = '<span class="text-muted">You have achieved the highest rank.</span>';
      return;
    }

    const meta = rankMeta[nextRank.id] || {};
    const rawPolygon = progress.rawPolygon || {};
    const gate = nextRank.gate || {};
    let gaps = [];

    if (gate.all_axes_min !== undefined) {
      const axes = progress.axisNames || [];
      for (const axis of axes) {
        const current = rawPolygon[axis] || 0;
        const needed = gate.all_axes_min;
        if (current < needed) {
          const label = (progress.axisLabels && progress.axisLabels[axis]) || axis;
          gaps.push({ label: label, current: current, needed: needed });
        }
      }
    }
    if (gate.axes_min) {
      for (const [axis, needed] of Object.entries(gate.axes_min)) {
        const current = rawPolygon[axis] || 0;
        if (current < needed) {
          const label = (progress.axisLabels && progress.axisLabels[axis]) || axis;
          gaps.push({ label: label, current: current, needed: needed });
        }
      }
    }

    let html = '<div class="next-rank-title">' + escapeHtml(nextRank.title) + '</div>';
    if (meta.description) {
      html += '<div class="next-rank-description">' + escapeHtml(meta.description) + '</div>';
    }

    // Quality gate gaps
    const qualityGate = nextRank.quality_gate;
    if (qualityGate) {
      const avgQuality = (progress.questionQuality && progress.questionQuality.avg_overall) || 0;
      if (avgQuality < qualityGate.avg_question_quality) {
        gaps.push({ label: 'Question Quality', current: avgQuality.toFixed(1), needed: qualityGate.avg_question_quality });
      }
      const sessionsAtRank = progress.sessionsAtCurrentRank || 0;
      if (sessionsAtRank < qualityGate.min_sessions_at_rank) {
        gaps.push({ label: 'Sessions at Rank', current: sessionsAtRank, needed: qualityGate.min_sessions_at_rank });
      }
    }

    if (gaps.length === 0) {
      html += '<span class="text-muted">All requirements met. Complete a sim to advance.</span>';
    } else {
      html += '<div class="next-rank-gaps">' +
        gaps.map(g => {
          const pct = Math.min(100, Math.round((parseFloat(g.current) / g.needed) * 100));
          return '<div class="next-rank-gap">' +
            '<span class="next-rank-gap-label">' + escapeHtml(g.label) + '</span>' +
            '<div class="next-rank-gap-bar"><div class="next-rank-gap-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="next-rank-gap-value">' + g.current + '/' + g.needed + '</span>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    container.innerHTML = html;
  }

  function renderRankProgression(history) {
    const container = document.getElementById('rank-progression');
    if (!container) return;

    if (!history.length) {
      container.innerHTML = '<span class="text-muted">Complete a simulation to begin your progression.</span>';
      return;
    }

    container.innerHTML = history.map(entry => {
      const id = entry.rank;
      const meta = rankMeta[id] || {};
      const icon = meta.icon || 'dot';
      return '<div class="rank-step">' +
        '<div class="rank-icon"><div class="rank-icon-' + icon + '"></div></div>' +
        '<div class="rank-step-title">' + escapeHtml(formatRankId(id)) + '</div>' +
        '<div class="rank-step-date">' + escapeHtml(entry.achieved) + '</div>' +
        '</div>';
    }).join('');
  }

  function formatRankId(id) {
    return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

    // Sort using server-provided sort scores, or fallback to weakness-first
    let progress;
    try {
      progress = progressData || await fetchJSON('/api/progress');
    } catch {
      progress = { rawPolygon: {}, maxDifficulty: 1, categoryMap: {}, axisNames: [] };
    }

    const rawPolygon = progress.rawPolygon || {};
    const pMaxDiff = progress.maxDifficulty || 1;
    const categoryMap = progress.categoryMap || {};

    const sorted = [...sims].sort((a, b) => {
      const aTypes = categoryMap[(a.category || '').toLowerCase()] || ['gather'];
      const bTypes = categoryMap[(b.category || '').toLowerCase()] || ['gather'];
      const aGap = aTypes.reduce((sum, t) => sum + (rawPolygon[t] || 0), 0) / aTypes.length;
      const bGap = bTypes.reduce((sum, t) => sum + (rawPolygon[t] || 0), 0) / bTypes.length;
      if (aGap !== bGap) return aGap - bGap;
      return (a.difficulty || 1) - (b.difficulty || 1);
    });

    const completedSims = (profile.completed_sims || []);

    grid.innerHTML = sorted.map(sim => {
      const maxDiff = 4;
      const dots = Array.from({ length: maxDiff }, (_, i) =>
        '<span class="difficulty-dot' + (i >= (sim.difficulty || 1) ? ' empty' : '') + '"></span>'
      ).join('');

      const services = (sim.services || []).map(s =>
        '<span class="service-tag">' + escapeHtml(s) + '</span>'
      ).join('');

      const inProgress = inProgressIds.includes(sim.id);

      const tooltip = sim.summary ? ' data-tooltip="' + escapeAttr(sim.summary) + '"' : '';
      return '<div class="sim-card fade-in' + (inProgress ? ' sim-card-resume' : '') + '" tabindex="0" data-sim-id="' + escapeAttr(sim.id) + '" data-category="' + escapeAttr(sim.category || '') + '"' + tooltip + '>' +
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
    // Single-sim enforcement: block if a session is already active
    if (currentSessionId && !isResume) {
      appendMessage('system', 'A simulation is already in progress. Quit it first before starting another.');
      return;
    }
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

    const themeId = 'calm-mentor';
    const assistMode = getSetting('assistMode', 'standard');
    const playtest = getSetting('playtest', 'player');
    const endpoint = isResume ? '/api/game/resume' : '/api/game/start';

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simId, themeId, assistMode, playtest })
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
          appendMessage('system', 'Simulation complete.');
        },
        profile_updating: () => {
          appendMessage('system', 'Updating your learning profile...');
        },
        profile_updated: () => {
          handleSessionComplete();
        },
        profile_update_failed: (data) => {
          appendMessage('system', 'Warning: profile update failed. ' + (data.message || ''));
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
          appendMessage('system', 'Simulation complete.');
        },
        profile_updating: () => {
          appendMessage('system', 'Updating your learning profile...');
        },
        profile_updated: () => {
          handleSessionComplete();
        },
        profile_update_failed: (data) => {
          appendMessage('system', 'Warning: profile update failed. ' + (data.message || ''));
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
          complete: () => appendMessage('system', 'Simulation complete.'),
          profile_updating: () => appendMessage('system', 'Updating your learning profile...'),
          profile_updated: () => handleSessionComplete(),
          profile_update_failed: (data) => { appendMessage('system', 'Warning: profile update failed.'); handleSessionComplete(); },
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
    currentSessionId = null;
    setTimeout(() => {
      resetChat();
      switchView('dashboard');
      if (typeof showCompletedDrilldown === 'function') {
        showCompletedDrilldown();
      }
    }, 1500);
    loadDashboard();
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
    div.className = 'chat-message ' + type + ' msg-enter';
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
        getSetting('uiTheme', 'ops-center'),
        (val) => { setSetting('uiTheme', val); loadUiTheme(val); }
      );
    } catch {
      // ignore
    }

    // Assist mode
    const assistOptions = [
      { value: 'standard', label: 'Standard' },
      { value: 'guided', label: 'Guided' }
    ];
    initCustomSelect(
      document.getElementById('select-assist-mode'),
      assistOptions,
      getSetting('assistMode', 'standard'),
      (val) => { setSetting('assistMode', val); }
    );

    // Play mode
    const playtestOptions = [
      { value: 'player', label: 'Player' },
      { value: 'playtester', label: 'Playtester' }
    ];
    initCustomSelect(
      document.getElementById('select-playtest'),
      playtestOptions,
      getSetting('playtest', 'player'),
      (val) => { setSetting('playtest', val); }
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
    const uiTheme = getSetting('uiTheme', 'ops-center');
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

    document.getElementById('btn-back-to-sims').addEventListener('click', () => {
      if (currentSessionId) {
        quitSim();
      } else {
        resetChat();
        loadSimPicker();
      }
    });

    // Completed drilldown
    document.getElementById('stat-completed-card').addEventListener('click', showCompletedDrilldown);
    document.getElementById('stat-completed-card').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCompletedDrilldown(); }
    });
    document.getElementById('stat-rank-card').addEventListener('click', hideCompletedDrilldown);
    document.getElementById('stat-rank-card').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideCompletedDrilldown(); }
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
