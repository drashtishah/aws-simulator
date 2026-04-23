import { $, escapeHtml, escapeAttr } from './dom-helpers.js';
import { stripNarratorMarkers } from './narrator-markers.js';
import { CollapsibleBlock, renderMermaidIn } from './reveal.js';

let isScrollPinned = true;
let sessionCompleted = false;
let currentNarratorDiv: HTMLElement | null = null;
let narratorBuffer = '';

export function isSessionCompleted(): boolean {
  return sessionCompleted;
}

export function setSessionCompleted(val: boolean): void {
  sessionCompleted = val;
}

export function resetNarratorTracking(): void {
  currentNarratorDiv = null;
  narratorBuffer = '';
}

export function finalizeNarratorStream(): void {
  const cleaned = stripNarratorMarkers(narratorBuffer).trim();
  if (currentNarratorDiv !== null && cleaned === '') {
    currentNarratorDiv.remove();
    currentNarratorDiv = null;
  } else if (currentNarratorDiv !== null) {
    currentNarratorDiv.innerHTML = renderMarkdown(cleaned);
    renderMermaidIn(currentNarratorDiv);
  }
  showTyping(false);
  if (!sessionCompleted) {
    setInputEnabled(true);
    ($('chat-input') as HTMLTextAreaElement).focus();
  }
}

export function resetChatUI(): void {
  sessionCompleted = false;
  $('chat-messages').innerHTML = '';
  $('chat').classList.remove('active');
  $('sim-picker').style.display = 'block';
  showTyping(false);
  setInputEnabled(true);
}

export function appendNarratorDelta(delta: string): void {
  if (currentNarratorDiv === null) {
    const div = document.createElement('div');
    div.className = 'chat-message narrator';
    $('chat-messages').appendChild(div);
    currentNarratorDiv = div;
  }
  narratorBuffer += delta;
  currentNarratorDiv.innerHTML = renderMarkdown(narratorBuffer);
  if (isScrollPinned) scrollToBottom();
}

export function appendMessage(type: string, content: string, event?: { label?: string; open?: boolean }): void {
  if (!content || !content.trim()) return;
  const messages = $('chat-messages');
  const div = document.createElement('div');

  if (type === 'narrator') {
    if (currentNarratorDiv !== null) {
      // Content already streamed via text_delta; skip.
      return;
    }
    div.className = 'chat-message narrator';
    div.innerHTML = renderMarkdown(content);
    messages.appendChild(div);
    if (isScrollPinned) scrollToBottom();
    return;
  }

  div.className = 'chat-message ' + type + ' msg-enter';

  if (type === 'dropdown') {
    const label = event?.label ?? 'Details';
    const open = event?.open ?? false;
    div.appendChild(CollapsibleBlock({
      title: label,
      bodyHtml: renderMarkdown(content),
      defaultOpen: open,
    }));
    renderMermaidIn(div);
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

export function showTyping(show: boolean): void {
  const indicator = $('typing-indicator');
  indicator.classList.toggle('visible', show);
  if (show) scrollToBottom();
}

export function setInputEnabled(enabled: boolean): void {
  const input = $('chat-input') as HTMLTextAreaElement;
  const sendBtn = $('btn-send') as HTMLButtonElement;
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

export function scrollToBottom(): void {
  const messages = $('chat-messages');
  messages.scrollTop = messages.scrollHeight;
}

export function setupScrollDetection(): void {
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

export function setupTextareaResize(): void {
  const input = $('chat-input') as HTMLTextAreaElement;
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}
