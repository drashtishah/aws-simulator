/**
 * Pure string utility: strips narrator marker blocks before rendering.
 * No DOM imports.
 */

export function stripNarratorMarkers(text: string): string {
  return text
    .replace(/\[DROPDOWN[^\]]*\][\s\S]*?\[\/DROPDOWN\]/g, '')
    .replace(/\[SESSION_COMPLETE\]/g, '');
}
