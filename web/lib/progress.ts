import path from 'node:path';
import * as progression from './progression.js';
import type { ProgressionConfig, Polygon } from './progression.js';

const CONFIG_PATH: string = path.join(__dirname, '..', '..', 'references', 'config', 'progression.yaml');
let _config: ProgressionConfig | undefined;

function getConfig(): ProgressionConfig {
  if (!_config) {
    _config = progression.loadConfig(CONFIG_PATH);
  }
  return _config;
}

function getQuestionTypes(): string[] {
  return progression.axisNames(getConfig());
}

function currentRank(polygon: Polygon | undefined): string {
  return progression.currentRank(polygon ?? {}, getConfig()).title;
}

function normalizeHexagon(polygon: Polygon | undefined, maxScale?: number): Polygon {
  return progression.normalizePolygon(polygon ?? {}, getConfig(), maxScale ?? 10);
}

interface CatalogRow {
  service: string;
  full_name: string;
  category: string;
  cert_relevance: string;
  knowledge_score: number;
  sims_completed: number;
  last_practiced: string;
  notes: string;
}

function parseCatalog(csvContent: string): CatalogRow[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(',');
  return lines.slice(1).filter(line => line.trim()).map(line => {
    const values: string[] = [];
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
      service: values[0] ?? '',
      full_name: values[1] ?? '',
      category: values[2] ?? '',
      cert_relevance: values[3] ?? '',
      knowledge_score: parseInt(values[4] ?? '0', 10) || 0,
      sims_completed: parseInt(values[5] ?? '0', 10) || 0,
      last_practiced: values[6] ?? '',
      notes: values[7] ?? ''
    };
  });
}

function serviceProgress(catalog: CatalogRow[]): { practiced: CatalogRow[]; unpracticed: CatalogRow[] } {
  const practiced = catalog
    .filter(s => s.sims_completed > 0)
    .sort((a, b) => b.knowledge_score - a.knowledge_score);
  const unpracticed = catalog.filter(s => s.sims_completed === 0);
  return { practiced, unpracticed };
}

export {
  getConfig,
  getQuestionTypes,
  currentRank,
  normalizeHexagon,
  parseCatalog,
  serviceProgress,
  progression,
};
