import { $, getSetting, setSetting, loadUiTheme, fetchJSON, escapeHtml, escapeAttr } from './dom-helpers.js';

export interface SelectOption {
  value: string;
  label: string;
}

export function initCustomSelect(el: HTMLElement, options: SelectOption[], currentValue: string, onChange: (val: string) => void): { setValue(val: string): void } {
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

export async function loadSettings(): Promise<void> {
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

export function formatThemeName(id: string): string {
  return id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
