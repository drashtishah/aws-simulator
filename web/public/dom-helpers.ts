export function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

export function getSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or quota exceeded
  }
}

export function loadUiTheme(themeId: string): void {
  const link = document.getElementById('ui-theme') as HTMLLinkElement | null;
  if (link) {
    link.href = '/ui-themes/' + themeId + '.css';
  }
}

export async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch ' + url);
  return res.json();
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
