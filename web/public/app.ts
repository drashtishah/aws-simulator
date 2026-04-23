/* AWS Incident Simulator - Frontend Application */

import { CollapsibleBlock, renderMermaidIn } from './reveal.js';
import { stripNarratorMarkers } from './narrator-markers.js';
import { filterAvailableSims } from './sim-picker-filter.js';
import { renderPolygon, renderNextRank, renderRankProgression, formatRankId } from './rank-display.js';
import { $, getSetting, setSetting, loadUiTheme, fetchJSON, escapeHtml, escapeAttr } from './dom-helpers.js';
import { ModalConfig, ModalAction, showConfirmModal, hideConfirmModal } from './modals.js';
import { SelectOption, initCustomSelect, loadSettings, formatThemeName } from './settings-pane.js';
import { isSessionCompleted, setSessionCompleted, resetChatUI, appendNarratorDelta, appendMessage, showTyping, setInputEnabled, scrollToBottom, setupScrollDetection, setupTextareaResize, resetNarratorTracking, finalizeNarratorStream } from './chat-renderer.js';
import { ProgressData, CompletedSim, RankGate, QualityGate, NextRank, RankHistoryEntry, getProgressData, loadDashboard, showCompletedDrilldown, hideCompletedDrilldown, scheduleReturnToDashboard } from './dashboard.js';

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

interface StreamEvent {
  type: string;
  sessionId?: string;
  content?: string;
  message?: string;
  label?: string;
  open?: boolean;
}

type StreamHandlers = Record<string, (data: StreamEvent) => void>;

// --- State ---
let currentView = 'dashboard';
let currentSessionId: string | null = null;
let currentSimId: string | null = null;
let registry: Registry = { sims: [] };
let profile: Profile = { completed_sims: [] };

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

// --- Sim Picker ---

async function loadSimPicker(): Promise<void> {
  try {
    registry = await fetchJSON('/api/registry');
  } catch {
    registry = { sims: [] };
  }

  let inProgressIds: string[] = [];
  let sessions: Array<{ status: string; sim_id: string }> = [];
  try {
    sessions = await fetchJSON('/api/sessions');
    inProgressIds = sessions.filter(s => s.status === 'in_progress').map(s => s.sim_id);
  } catch {
    // ignore
  }

  // Hide sims that have a completed session
  registry.sims = filterAvailableSims(registry.sims, sessions);

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
    progress = getProgressData() || await fetchJSON('/api/progress');
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

    resetNarratorTracking();
    await streamResponse(response, {
      session: (data: StreamEvent) => {
        currentSessionId = data.sessionId || null;
      },
      text: (data: StreamEvent) => {
        appendMessage('narrator', data.content || '');
      },
      text_delta: (data: StreamEvent) => {
        appendNarratorDelta(data.content || '');
      },
      dropdown: (data: StreamEvent) => {
        appendMessage('dropdown', data.content || '', { label: data.label, open: data.open });
      },
      complete: () => {
        setSessionCompleted(true);
        setInputEnabled(false);
        appendMessage('system', 'Simulation complete.');
        scheduleReturnToDashboard();
      },
      profile_updating: () => {
        handleSessionComplete('updating');
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
      done: () => finalizeNarratorStream()
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

    resetNarratorTracking();
    await streamResponse(response, {
      text: (data: StreamEvent) => {
        appendMessage('narrator', data.content || '');
      },
      text_delta: (data: StreamEvent) => {
        appendNarratorDelta(data.content || '');
      },
      dropdown: (data: StreamEvent) => {
        appendMessage('dropdown', data.content || '', { label: data.label, open: data.open });
      },
      complete: () => {
        setSessionCompleted(true);
        setInputEnabled(false);
        appendMessage('system', 'Simulation complete.');
        scheduleReturnToDashboard();
      },
      profile_updating: () => {
        handleSessionComplete('updating');
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
      done: () => finalizeNarratorStream()
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
      resetNarratorTracking();
      await streamResponse(retryResponse, {
        text: (data: StreamEvent) => appendMessage('narrator', data.content || ''),
        text_delta: (data: StreamEvent) => appendNarratorDelta(data.content || ''),
        dropdown: (data: StreamEvent) => appendMessage('dropdown', data.content || '', { label: data.label, open: data.open }),
        complete: () => {
          setSessionCompleted(true);
          setInputEnabled(false);
          appendMessage('system', 'Simulation complete.');
          scheduleReturnToDashboard();
        },
        profile_updating: () => handleSessionComplete('updating'),
        profile_updated: () => handleSessionComplete('updated'),
        profile_update_failed: (data: StreamEvent) => { appendMessage('system', 'Warning: profile update failed. ' + (data.message || '')); handleSessionComplete('failed', data.message); },
        error: (data: StreamEvent) => appendMessage('system', 'Error: ' + (data.message || 'Unknown error')),
        done: () => finalizeNarratorStream()
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
  if (profileStatus === 'updating') {
    body = 'Simulation complete. We will update your learner profile. You can play other sims in the meantime.';
  } else if (profileStatus === 'updated') {
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
  resetChatUI();
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
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micTrack = micStream.getAudioTracks()[0];
      if (micTrack) {
        await new Promise<void>(resolve => {
          if (micTrack.readyState === 'live') resolve();
          else micTrack.addEventListener('unmute', () => resolve(), { once: true });
        });
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      stream = await (navigator.mediaDevices as any).getDisplayMedia({
        preferCurrentTab: true,
        video: true,
        audio: false
      });
      if (micTrack) stream.addTrack(micTrack);
    } catch {
      btn.classList.remove('recording');
      return;
    }
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
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
