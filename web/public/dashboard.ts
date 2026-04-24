import { $, fetchJSON, escapeHtml, escapeAttr } from './dom-helpers.js';
import { renderPolygon, renderNextRank, renderRankProgression } from './rank-display.js';

export interface CompletedSim {
  title: string;
  difficulty?: number;
  category?: string;
  questionTypes?: string[];
  summary?: string;
}

export interface RankGate {
  all_axes_min?: number;
  axes_min?: Record<string, number>;
}

export interface QualityGate {
  avg_question_quality: number;
  min_sessions_at_rank: number;
}

export interface NextRank {
  id: string;
  title: string;
  gate?: RankGate;
  quality_gate?: QualityGate;
}

export interface ProgressData {
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

export interface RankHistoryEntry {
  rank: string;
  achieved: string;
}

let progressData: ProgressData | null = null;

export function getProgressData(): ProgressData | null {
  return progressData;
}

export async function loadDashboard(): Promise<void> {
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

export function showCompletedDrilldown(): void {
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

export function hideCompletedDrilldown(): void {
  $('completed-drilldown').style.display = 'none';
  $('dashboard-content').style.display = 'block';
}

export const COMPLETE_TO_DASHBOARD_MS = 1500;

export function scheduleReturnToDashboard(): void {
  setTimeout(() => {
    document.getElementById('tab-dashboard')?.click();
  }, COMPLETE_TO_DASHBOARD_MS);
}
