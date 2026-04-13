/* Rank display helpers - extracted from app.ts */

// --- Types (copied; avoids circular import) ---

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
  completedSims?: unknown[];
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

interface GapEntry {
  label: string;
  current: number | string;
  needed: number;
}

// --- Local helpers (pure; not exported) ---

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Rank metadata ---

const rankMeta: Record<string, RankMeta> = {
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

// --- Exported render functions ---

export function renderPolygon(polygon: Record<string, number>, axes: string[], axisLabels: Record<string, string>, polygonLastAdvanced: Record<string, string>): void {
  const svg = document.getElementById('hexagon-svg')!;
  const cx = 150, cy = 150, radius = 110;
  const n = axes.length;
  if (n === 0) return;

  // Check which axes are fading (> 21 days since last advanced)
  const fadingAxes = new Set<string>();
  if (polygonLastAdvanced) {
    const now = new Date();
    for (const axis of axes) {
      const last = polygonLastAdvanced[axis];
      if (last) {
        const daysSince = (now.getTime() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince >= 21) fadingAxes.add(axis);
      }
    }
  }

  function getPoint(index: number, value: number, maxVal: number): { x: number; y: number } {
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
    const points: string[] = [];
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
  const dataPoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const val = polygon[axes[i]!] || 0;
    const p = getPoint(i, val, 10);
    dataPoints.push(p.x + ',' + p.y);
  }
  svgContent += '<polygon points="' + dataPoints.join(' ') + '" class="hexagon-polygon" />';

  // Data points (dots), with fading indicator
  for (let i = 0; i < n; i++) {
    const axis = axes[i]!;
    const val = polygon[axis] || 0;
    const p = getPoint(i, val, 10);
    const fadingClass = fadingAxes.has(axis) ? ' hexagon-dot-fading' : '';
    svgContent += '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" class="hexagon-dot' + fadingClass + '" />';
  }

  // Axis descriptions: example questions for each type
  const axisDescriptions: Record<string, string> = {
    gather: 'What do the logs and metrics show?',
    diagnose: 'What is causing this behavior?',
    correlate: 'What else changed around the same time?',
    impact: 'How many users and services are affected?',
    trace: 'Where does the request fail in the chain?',
    fix: 'What would resolve this and how do we verify?'
  };

  // Labels, with fading indicator
  for (let i = 0; i < n; i++) {
    const axis = axes[i]!;
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
    const svgEl = document.getElementById('hexagon-svg')!;
    const svgRect = svgEl.getBoundingClientRect();
    const vb = { x: -40, y: -10, w: 380, h: 320 };
    const scaleX = svgRect.width / vb.w;
    const scaleY = svgRect.height / vb.h;

    hotspots.innerHTML = axes.map((axis: string, i: number) => {
      const label = (axisLabels && axisLabels[axis]) || axis;
      const desc = axisDescriptions[axis] || '';
      const p = getPoint(i, 12, 10);
      const px = (p.x - vb.x) * scaleX;
      const py = (p.y - vb.y) * scaleY;
      return '<div class="hexagon-hotspot" data-tooltip="' + escapeAttr(desc) + '" style="left:' + px + 'px;top:' + py + 'px;transform:translate(-50%,-50%)">' + escapeHtml(label) + '</div>';
    }).join('');
  }
}

export function renderNextRank(progress: ProgressData): void {
  const container = document.getElementById('next-rank-info');
  if (!container) return;

  const nextRank = progress.nextRank;
  if (!nextRank) {
    container.innerHTML = '<span class="text-muted">You have achieved the highest rank.</span>';
    return;
  }

  const meta = rankMeta[nextRank.id] || { description: '', icon: 'dot' };
  const rawPolygon = progress.rawPolygon || {};
  const gate = nextRank.gate || {};
  const gaps: GapEntry[] = [];

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
      gaps.map((g: GapEntry) => {
        const pct = Math.min(100, Math.round((parseFloat(String(g.current)) / g.needed) * 100));
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

export function renderRankProgression(history: RankHistoryEntry[]): void {
  const container = document.getElementById('rank-progression');
  if (!container) return;

  if (!history.length) {
    container.innerHTML = '<span class="text-muted">Complete a simulation to begin your progression.</span>';
    return;
  }

  container.innerHTML = history.map((entry: RankHistoryEntry) => {
    const id = entry.rank;
    const meta = rankMeta[id] || { description: '', icon: 'dot' };
    const icon = meta.icon || 'dot';
    return '<div class="rank-step">' +
      '<div class="rank-icon"><div class="rank-icon-' + icon + '"></div></div>' +
      '<div class="rank-step-title">' + escapeHtml(formatRankId(id)) + '</div>' +
      '<div class="rank-step-date">' + escapeHtml(entry.achieved) + '</div>' +
      '</div>';
  }).join('');
}

export function formatRankId(id: string): string {
  return id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
