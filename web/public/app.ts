/* AWS Incident Simulator - Frontend Application */


// --- Types ---

interface SimEntry {
  id: string;
  title: string;
  category?: string;
  difficulty?: number;
  services?: string[];
  summary?: string;
}

interface Registry {
  sims: SimEntry[];
}

interface Profile {
  completed_sims: string[];
}

interface CompletedSim {
  title: string;
  difficulty?: number;
  category?: string;
  questionTypes?: string[];
  summary?: string;
}

interface RankGate {
  all_axes_min?: number;
  axes_min?: Record<string, number>;
}

interface QualityGate {
  avg_question_quality: number;
  min_sessions_at_rank: number;
}

interface NextRank {
  id: string;
  title: string;
  gate?: RankGate;
  quality_gate?: QualityGate;
}

interface ProgressData {
  rank: string;
  rankTitle: string;
  polygon: Record<string, number>;
  rawPolygon: Record<string, number>;
  axisNames: string[];
  axisLabels: Record<string, string>;
  simsCompleted: number;
  servicesEncountered: string[];
  polygonLastAdvanced: Record<string, string>;
  rankHistory: RankHistoryEntry[];
  challengeRuns: unknown[];
  maxDifficulty: number;
  assist: Record<string, unknown>;
  nextRank?: NextRank;
  completedSims?: CompletedSim[];
  categoryMap?: Record<string, string[]>;
  questionQuality?: { avg_overall: number };
  sessionsAtCurrentRank?: number;
}

interface RankHistoryEntry {
  rank: string;
  achieved: string;
}

interface RankMeta {
  description: string;
  icon: string;
}

interface StreamEvent {
  type: string;
  sessionId?: string;
  content?: string;
  message?: string;
}

type StreamHandlers = Record<string, (data: StreamEvent) => void>;

interface ModalAction {
  label: string;
  primary: boolean;
  onClick: () => void;
}

interface ModalConfig {
  title: string;
  body: string;
  actions: ModalAction[];
}

interface SelectOption {
  value: string;
  label: string;
}

interface GapEntry {
  label: string;
  current: number | string;
  needed: number;
}

import { renderPolygon, renderNextRank, renderRankProgression, formatRankId } from './rank-display.js';

// --- Helpers ---

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

// --- State ---
let currentView = 'dashboard';
let currentSessionId: string | null = null;
let currentSimId: string | null = null;
let registry: Registry = { sims: [] };
let profile: Profile = { completed_sims: [] };
let progressData: ProgressData | null = null;
let isScrollPinned = true;
let sessionCompleted = false;

// --- Settings (localStorage with fallback) ---

function getSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function setSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or quota exceeded
  }
}

// --- Theme Loading ---

function loadUiTheme(themeId: string): void {
  const link = document.getElementById('ui-theme') as HTMLLinkElement | null;
  if (link) {
    link.href = '/ui-themes/' + themeId + '.css';
  }
}

// --- API Helpers ---

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch ' + url);
  return res.json();
}

// --- SSE Stream Consumer ---

async function streamResponse(response: Response, handlers: StreamHandlers): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as StreamEvent;
          const handler = handlers[data.type];
          if (handler) {
            handler(data);
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  }
}

// --- View Management ---

function switchView(view: string): void {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $('view-' + view).classList.add('active');

  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => {
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

async function loadDashboard(): Promise<void> {
  let progress: ProgressData;
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

  $('stat-rank-title').textContent = progress.rankTitle;
  $('stat-completed').textContent = String(progress.simsCompleted);

  // Dynamic polygon SVG
  renderPolygon(progress.polygon, progress.axisNames, progress.axisLabels, progress.polygonLastAdvanced);

  // Next rank preview
  renderNextRank(progress);

  // Rank history
  renderRankProgression(progress.rankHistory || []);

  // Services encountered
  const servicesList = $('services-list');
  if (progress.servicesEncountered.length) {
    servicesList.innerHTML = progress.servicesEncountered.map((name: string) =>
      '<span class="service-encountered-tag">' + escapeHtml(name) + '</span>'
    ).join('');
  } else {
    servicesList.innerHTML = '<span class="text-muted">No services encountered yet. Play a simulation to begin.</span>';
  }
}

function showCompletedDrilldown(): void {
  if (!progressData || !progressData.completedSims || !progressData.completedSims.length) return;

  $('dashboard-content').style.display = 'none';
  const drilldown = $('completed-drilldown');
  drilldown.style.display = 'block';

  const grid = $('completed-grid');
  grid.innerHTML = progressData.completedSims.map((sim: CompletedSim) => {
    const maxDiff = 4;
    const dots = Array.from({ length: maxDiff }, (_, i) =>
      '<span class="difficulty-dot' + (i >= (sim.difficulty || 1) ? ' empty' : '') + '"></span>'
    ).join('');

    const qTypes = (sim.questionTypes || []).map((t: string) =>
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

function hideCompletedDrilldown(): void {
  $('completed-drilldown').style.display = 'none';
  $('dashboard-content').style.display = 'block';
}


// --- Sim Picker ---

async function loadSimPicker(): Promise<void> {
  try {
    registry = await fetchJSON('/api/registry');
  } catch {
    registry = { sims: [] };
  }

  let inProgressIds: string[] = [];
  try {
    const sessions: Array<{ status: string; sim_id: string }> = await fetchJSON('/api/sessions');
    inProgressIds = sessions.filter(s => s.status === 'in_progress').map(s => s.sim_id);
  } catch {
    // ignore
  }

  const grid = $('sim-grid');
  const empty = $('sim-empty');
  const picker = $('sim-picker');
  const chat = $('chat');

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
  let progress: ProgressData;
  try {
    progress = progressData || await fetchJSON('/api/progress');
  } catch {
    progress = { rawPolygon: {}, maxDifficulty: 1, categoryMap: {}, axisNames: [] } as unknown as ProgressData;
  }

  const rawPolygon = progress.rawPolygon || {};
  const categoryMap = progress.categoryMap || {};

  const sorted = [...sims].sort((a: SimEntry, b: SimEntry) => {
    const aTypes = categoryMap[(a.category || '').toLowerCase()] || ['gather'];
    const bTypes = categoryMap[(b.category || '').toLowerCase()] || ['gather'];
    const aGap = aTypes.reduce((sum: number, t: string) => sum + (rawPolygon[t] || 0), 0) / aTypes.length;
    const bGap = bTypes.reduce((sum: number, t: string) => sum + (rawPolygon[t] || 0), 0) / bTypes.length;
    if (aGap !== bGap) return aGap - bGap;
    return (a.difficulty || 1) - (b.difficulty || 1);
  });

  grid.innerHTML = sorted.map((sim: SimEntry) => {
    const maxDiff = 4;
    const dots = Array.from({ length: maxDiff }, (_, i) =>
      '<span class="difficulty-dot' + (i >= (sim.difficulty || 1) ? ' empty' : '') + '"></span>'
    ).join('');

    const services = (sim.services || []).map((s: string) =>
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
  grid.querySelectorAll<HTMLElement>('.sim-card').forEach(card => {
    card.addEventListener('click', () => startSim(card.dataset.simId!, false));
    card.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startSim(card.dataset.simId!, false);
      }
    });
  });
}

// --- Chat ---

async function startSim(simId: string, isResume: boolean): Promise<void> {
  // Single-sim enforcement: block if a session is already active
  if (currentSessionId && !isResume) {
    appendMessage('system', 'A simulation is already in progress. Quit it first before starting another.');
    return;
  }
  currentSimId = simId;

  // Find sim title
  const sim = (registry.sims || []).find((s: SimEntry) => s.id === simId);
  $('chat-sim-title').textContent = sim ? sim.title : simId;

  // Show chat, hide picker
  $('sim-picker').style.display = 'none';
  const chat = $('chat');
  chat.classList.add('active');

  // Clear messages
  const messages = $('chat-messages');
  messages.innerHTML = '';

  const input = $('chat-input') as HTMLTextAreaElement;
  setInputEnabled(false);
  showTyping(true);

  const themeId = 'calm-mentor';
  const endpoint = isResume ? '/api/game/resume' : '/api/game/start';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simId, themeId })
    });

    await streamResponse(response, {
      session: (data: StreamEvent) => {
        currentSessionId = data.sessionId || null;
      },
      text: (data: StreamEvent) => {
        appendMessage('narrator', data.content || '');
      },
      console: (data: StreamEvent) => {
        appendMessage('console', data.content || '');
      },
      coaching: (data: StreamEvent) => {
        appendMessage('coaching', data.content || '');
      },
      complete: () => {
        sessionCompleted = true;
        setInputEnabled(false);
        appendMessage('system', 'Simulation complete.');
      },
      profile_updating: () => {
        appendMessage('system', 'Updating your learning profile...');
      },
      profile_updated: () => {
        handleSessionComplete('updated');
      },
      profile_update_failed: (data: StreamEvent) => {
        appendMessage('system', 'Warning: profile update failed. ' + (data.message || ''));
        handleSessionComplete('failed', data.message);
      },
      error: (data: StreamEvent) => {
        appendMessage('system', 'Error: ' + (data.message || 'Unknown error'));
      },
      warning: (data: StreamEvent) => {
        appendMessage('system', data.message || '');
      },
      done: () => {
        showTyping(false);
        if (!sessionCompleted) {
          setInputEnabled(true);
          input.focus();
        }
      }
    });
  } catch {
    showTyping(false);
    appendMessage('system', 'Connection lost. Please try again.');
    setInputEnabled(true);
  }
}

async function sendMessage(): Promise<void> {
  const input = $('chat-input') as HTMLTextAreaElement;
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
      text: (data: StreamEvent) => {
        appendMessage('narrator', data.content || '');
      },
      console: (data: StreamEvent) => {
        appendMessage('console', data.content || '');
      },
      coaching: (data: StreamEvent) => {
        appendMessage('coaching', data.content || '');
      },
      complete: () => {
        sessionCompleted = true;
        setInputEnabled(false);
        appendMessage('system', 'Simulation complete.');
      },
      profile_updating: () => {
        appendMessage('system', 'Updating your learning profile...');
      },
      profile_updated: () => {
        handleSessionComplete('updated');
      },
      profile_update_failed: (data: StreamEvent) => {
        appendMessage('system', 'Warning: profile update failed. ' + (data.message || ''));
        handleSessionComplete('failed', data.message);
      },
      error: (data: StreamEvent) => {
        appendMessage('system', 'Error: ' + (data.message || 'Unknown error'));
      },
      warning: (data: StreamEvent) => {
        appendMessage('system', data.message || '');
      },
      done: () => {
        showTyping(false);
        if (!sessionCompleted) {
          setInputEnabled(true);
          input.focus();
        }
      }
    });
  } catch {
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
        text: (data: StreamEvent) => appendMessage('narrator', data.content || ''),
        console: (data: StreamEvent) => appendMessage('console', data.content || ''),
        coaching: (data: StreamEvent) => appendMessage('coaching', data.content || ''),
        complete: () => { sessionCompleted = true; setInputEnabled(false); appendMessage('system', 'Simulation complete.'); },
        profile_updating: () => appendMessage('system', 'Updating your learning profile...'),
        profile_updated: () => handleSessionComplete('updated'),
        profile_update_failed: (data: StreamEvent) => { appendMessage('system', 'Warning: profile update failed. ' + (data.message || '')); handleSessionComplete('failed', data.message); },
        error: (data: StreamEvent) => appendMessage('system', 'Error: ' + (data.message || 'Unknown error')),
        done: () => {
          showTyping(false);
          if (!sessionCompleted) {
            setInputEnabled(true);
            input.focus();
          }
        }
      });
    } catch {
      showTyping(false);
      appendMessage('system', 'Could not reconnect. Try sending your message again.');
      setInputEnabled(true);
    }
  }
}

function handleSessionComplete(profileStatus: string, errorMessage?: string): void {
  const title = 'Simulation Complete';
  let body: string;
  if (profileStatus === 'updated') {
    body = 'Your learning profile has been updated.';
  } else if (profileStatus === 'failed') {
    body = 'Learning profile update failed' + (errorMessage ? ': ' + errorMessage : '') + '.';
  } else {
    body = 'Session ended.';
  }

  showConfirmModal({
    title,
    body,
    actions: [
      { label: 'Return to Dashboard', primary: true, onClick: () => {
        currentSessionId = null;
        sessionCompleted = false;
        resetChat();
        switchView('dashboard');
        loadDashboard();
        showCompletedDrilldown();
      }}
    ]
  });
}

async function quitSim(): Promise<void> {
  if (!currentSessionId) return;
  showConfirmModal({
    title: 'Leave Simulation',
    body: 'Your progress is saved. You can resume this simulation later.',
    actions: [
      { label: 'Continue', primary: false, onClick: () => {} },
      { label: 'Quit', primary: true, onClick: async () => {
        try {
          await fetch('/api/game/quit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId })
          });
        } catch { /* ignore quit errors */ }
        resetChat();
        loadSimPicker();
      }}
    ]
  });
}

function resetChat(): void {
  currentSessionId = null;
  currentSimId = null;
  sessionCompleted = false;
  $('chat-messages').innerHTML = '';
  $('chat').classList.remove('active');
  $('sim-picker').style.display = 'block';
  showTyping(false);
  setInputEnabled(true);
}

// --- Confirmation Modal ---

function showConfirmModal({ title, body, actions }: ModalConfig): void {
  $('confirm-modal-title').textContent = title;
  $('confirm-modal-body').textContent = body;
  const actionsEl = $('confirm-modal-actions');
  actionsEl.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (action.primary ? 'btn-primary' : 'btn-secondary');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      hideConfirmModal();
      if (action.onClick) action.onClick();
    });
    actionsEl.appendChild(btn);
  }
  $('confirm-modal').classList.add('active');
}

function hideConfirmModal(): void {
  $('confirm-modal').classList.remove('active');
}

// --- Chat UI Helpers ---

function appendMessage(type: string, content: string): void {
  if (!content || !content.trim()) return;
  const messages = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-message ' + type + ' msg-enter';
  if (type === 'narrator' || type === 'coaching') {
    div.innerHTML = renderMarkdown(content);
    // Render any Mermaid diagrams in the message
    if (typeof mermaid !== 'undefined') {
      const codeBlocks = div.querySelectorAll('pre code.language-mermaid');
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
  } else {
    div.textContent = content;
  }
  messages.appendChild(div);

  if (isScrollPinned) {
    scrollToBottom();
  } else {
    $('new-messages-pill').classList.add('visible');
  }
}

function showTyping(show: boolean): void {
  const indicator = $('typing-indicator');
  indicator.classList.toggle('visible', show);
  if (show) scrollToBottom();
}

function setInputEnabled(enabled: boolean): void {
  const input = $('chat-input') as HTMLTextAreaElement;
  const sendBtn = $('btn-send') as HTMLButtonElement;
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

function scrollToBottom(): void {
  const messages = $('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

// --- Scroll Detection ---

function setupScrollDetection(): void {
  const messages = $('chat-messages');
  messages.addEventListener('scroll', () => {
    const threshold = 50;
    isScrollPinned = messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
    if (isScrollPinned) {
      $('new-messages-pill').classList.remove('visible');
    }
  });

  $('new-messages-pill').addEventListener('click', () => {
    scrollToBottom();
    $('new-messages-pill').classList.remove('visible');
  });
}

// --- Settings ---

function initCustomSelect(el: HTMLElement, options: SelectOption[], currentValue: string, onChange: (val: string) => void): { setValue(val: string): void } {
  const trigger = el.querySelector('.custom-select-trigger') as HTMLElement;
  const optionsList = el.querySelector('.custom-select-options') as HTMLElement;
  let selectedValue = currentValue;

  function render(): void {
    const current = options.find(o => o.value === selectedValue) || options[0];
    if (current) trigger.textContent = current.label;

    optionsList.innerHTML = options.map((o: SelectOption) =>
      '<div class="custom-select-option' + (o.value === selectedValue ? ' selected' : '') +
      '" data-value="' + escapeAttr(o.value) + '" role="option">' +
      escapeHtml(o.label) + '</div>'
    ).join('');
  }

  trigger.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach(s => {
      if (s !== el) s.classList.remove('open');
    });
    el.classList.toggle('open');
    trigger.setAttribute('aria-expanded', el.classList.contains('open') ? 'true' : 'false');
  });

  optionsList.addEventListener('click', (e: Event) => {
    const opt = (e.target as HTMLElement).closest('.custom-select-option') as HTMLElement | null;
    if (!opt) return;
    selectedValue = opt.dataset.value || '';
    el.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    render();
    onChange(selectedValue);
  });

  document.addEventListener('click', (e: Event) => {
    if (!el.contains(e.target as Node)) {
      el.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  trigger.addEventListener('keydown', (e: KeyboardEvent) => {
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
    setValue(val: string) { selectedValue = val; render(); }
  };
}

async function loadSettings(): Promise<void> {
  // UI themes
  try {
    const uiThemes: string[] = await fetchJSON('/api/ui-themes');
    const options = uiThemes.map((t: string) => ({ value: t, label: formatThemeName(t) }));
    initCustomSelect(
      $('select-ui-theme'),
      options,
      getSetting('uiTheme', 'ops-center'),
      (val: string) => { setSetting('uiTheme', val); loadUiTheme(val); }
    );
  } catch {
    // ignore
  }


}

function formatThemeName(id: string): string {
  return id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// --- Textarea Auto-resize ---

function setupTextareaResize(): void {
  const input = $('chat-input') as HTMLTextAreaElement;
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

// --- Escape Helpers ---

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Event Bindings ---

function init(): void {
  // Initialize Mermaid with dark theme
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ startOnLoad: false, theme: 'dark' });
  }

  // Load UI theme
  const uiTheme = getSetting('uiTheme', 'ops-center');
  loadUiTheme(uiTheme);

  // Tab navigation
  document.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view || ''));
  });

  // Settings
  $('btn-settings').addEventListener('click', () => {
    $('settings-modal').classList.add('active');
  });

  $('btn-close-settings').addEventListener('click', () => {
    $('settings-modal').classList.remove('active');
  });

  $('settings-modal').addEventListener('click', (e: Event) => {
    if (e.target === e.currentTarget) {
      (e.currentTarget as HTMLElement).classList.remove('active');
    }
  });

  // Chat controls
  $('btn-send').addEventListener('click', sendMessage);
  $('chat-input').addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !ke.shiftKey) {
      ke.preventDefault();
      sendMessage();
    }
  });

  $('btn-back-to-sims').addEventListener('click', () => {
    if (currentSessionId) {
      quitSim();
    } else {
      resetChat();
      loadSimPicker();
    }
  });

  // Completed drilldown
  $('stat-completed-card').addEventListener('click', showCompletedDrilldown);
  $('stat-completed-card').addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); showCompletedDrilldown(); }
  });
  $('stat-rank-card').addEventListener('click', hideCompletedDrilldown);
  $('stat-rank-card').addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') { ke.preventDefault(); hideCompletedDrilldown(); }
  });

  // Setup helpers
  setupScrollDetection();
  setupTextareaResize();
  initRecorder();

  // Load initial data
  loadDashboard();
  loadSettings();
}

// --- Recorder ---

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: BlobPart[] = [];

function initRecorder(): void {
  const btn = document.getElementById('btn-record') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: true,
        audio: true
      });
    } catch {
      btn.classList.remove('recording');
      return;
    }
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorder.addEventListener('dataavailable', e => { if (e.data.size > 0) recordedChunks.push(e.data); });
    mediaRecorder.addEventListener('stop', async () => {
      btn.classList.remove('recording');
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      try {
        const res = await fetch('/api/save-recording', {
          method: 'POST',
          headers: { 'Content-Type': 'video/webm' },
          body: blob
        });
        if (res.status === 201) {
          const { filename } = await res.json() as { filename: string };
          const toast = document.createElement('div');
          toast.textContent = `Saved: ${filename}`;
          toast.style.cssText = 'position:fixed;bottom:16px;right:16px;background:var(--bg-elevated);padding:8px 12px;border-radius:6px;font-size:13px;z-index:9999';
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 4000);
        } else {
          console.error('Recording upload failed:', res.status);
        }
      } catch {
        console.error('Recording upload error');
      } finally {
        mediaRecorder = null;
      }
    });
    btn.classList.add('recording');
    mediaRecorder.start();
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener('ended', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      });
    }
  });
}

// --- Start ---
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
