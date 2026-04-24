import { $ } from './dom-helpers.js';

export interface ModalAction {
  label: string;
  primary: boolean;
  onClick: () => void;
}

export interface ModalConfig {
  title: string;
  body: string;
  actions: ModalAction[];
}

export function showConfirmModal({ title, body, actions }: ModalConfig): void {
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

export function hideConfirmModal(): void {
  $('confirm-modal').classList.remove('active');
}
