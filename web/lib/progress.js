'use strict';

const QUESTION_TYPES = ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];

const LEVEL_TITLES = [
  'Pager Duty Intern',
  'Config Whisperer',
  'Root Cause Wrangler',
  'Incident Commander',
  'Chaos Architect'
];

const RANK_THRESHOLDS = [
  {
    title: 'Chaos Architect',
    test: (hex) => QUESTION_TYPES.every(t => (hex[t] || 0) >= 6)
  },
  {
    title: 'Incident Commander',
    test: (hex) => QUESTION_TYPES.every(t => (hex[t] || 0) >= 3)
  },
  {
    title: 'Root Cause Wrangler',
    test: (hex) => {
      const atLeast3 = QUESTION_TYPES.filter(t => (hex[t] || 0) >= 3).length;
      return (hex.correlate || 0) >= 3 && atLeast3 >= 3;
    }
  },
  {
    title: 'Config Whisperer',
    test: (hex) => (hex.gather || 0) >= 3 && (hex.diagnose || 0) >= 3
  },
  {
    title: 'Pager Duty Intern',
    test: () => true
  }
];

function currentRank(hexagon) {
  for (const rank of RANK_THRESHOLDS) {
    if (rank.test(hexagon || {})) return rank.title;
  }
  return RANK_THRESHOLDS[RANK_THRESHOLDS.length - 1].title;
}

function normalizeHexagon(hexagon, maxScale) {
  maxScale = maxScale || 10;
  const max = Math.max(...QUESTION_TYPES.map(t => hexagon[t] || 0), 1);
  const result = {};
  for (const t of QUESTION_TYPES) {
    result[t] = Math.round(((hexagon[t] || 0) / max) * maxScale * 10) / 10;
  }
  return result;
}

function levelTitle(level) {
  const idx = Math.max(0, Math.min((level || 1) - 1, LEVEL_TITLES.length - 1));
  return LEVEL_TITLES[idx];
}

function parseCatalog(csvContent) {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',');
  return lines.slice(1).filter(line => line.trim()).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes && values.length < headers.length - 1) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return {
      service: values[0] || '',
      full_name: values[1] || '',
      category: values[2] || '',
      cert_relevance: values[3] || '',
      knowledge_score: parseInt(values[4], 10) || 0,
      sims_completed: parseInt(values[5], 10) || 0,
      last_practiced: values[6] || '',
      notes: values[7] || ''
    };
  });
}

function serviceProgress(catalog) {
  const practiced = catalog
    .filter(s => s.sims_completed > 0)
    .sort((a, b) => b.knowledge_score - a.knowledge_score);
  const unpracticed = catalog.filter(s => s.sims_completed === 0);
  return { practiced, unpracticed };
}

module.exports = {
  QUESTION_TYPES,
  LEVEL_TITLES,
  RANK_THRESHOLDS,
  currentRank,
  normalizeHexagon,
  levelTitle,
  parseCatalog,
  serviceProgress
};
