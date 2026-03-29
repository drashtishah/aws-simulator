'use strict';

const path = require('path');
const progression = require('./progression');

// Load progression config once at module load
const CONFIG_PATH = path.join(__dirname, '..', '..', 'references', 'progression.yaml');
let _config;

function getConfig() {
  if (!_config) {
    _config = progression.loadConfig(CONFIG_PATH);
  }
  return _config;
}

// Derived from config for backwards compatibility
function getQuestionTypes() {
  return progression.axisNames(getConfig());
}

function currentRank(polygon) {
  return progression.currentRank(polygon || {}, getConfig()).title;
}

function normalizeHexagon(polygon, maxScale) {
  return progression.normalizePolygon(polygon || {}, getConfig(), maxScale || 10);
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
  getConfig,
  getQuestionTypes,
  currentRank,
  normalizeHexagon,
  parseCatalog,
  serviceProgress,
  // Re-export progression engine for direct access
  progression,
};
