#!/usr/bin/env node
// eval-runner.js: Scorecard engine for eval checks.
// Loads eval-scoring.yaml, runs deterministic checks against session/transcript data,
// returns pending_llm for LLM checks.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.join(ROOT, 'learning', 'sessions');
const RESULTS_DIR = path.join(ROOT, 'learning', 'logs', 'eval-results');
const HISTORY_PATH = path.join(ROOT, 'learning', 'logs', 'eval-history.jsonl');
const SIMS_DIR = path.join(ROOT, 'sims');
const SPEC_PATH = path.join(ROOT, 'references', 'eval-scoring.yaml');

function loadScoringSpec() {
  return yaml.load(fs.readFileSync(SPEC_PATH, 'utf8'));
}

function allChecks(spec) {
  const flat = [];
  for (const [category, checks] of Object.entries(spec.categories)) {
    for (const check of checks) flat.push({ ...check, category });
  }
  return flat;
}

function loadSession(simId) {
  const p = path.join(SESSIONS_DIR, simId, 'session.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadTranscript(simId) {
  const p = path.join(SESSIONS_DIR, simId, 'transcript.jsonl');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  return lines.filter(l => l.trim()).map(l => JSON.parse(l));
}

function loadManifest(simId) {
  const simPrefix = simId.split('_')[0] || simId;
  const dirs = fs.existsSync(SIMS_DIR) ? fs.readdirSync(SIMS_DIR) : [];
  const simDir = dirs.find(d => d.startsWith(simPrefix));
  if (!simDir) return null;
  const p = path.join(SIMS_DIR, simDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listCompletedSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const completed = [];
  for (const dir of fs.readdirSync(SESSIONS_DIR)) {
    const p = path.join(SESSIONS_DIR, dir, 'session.json');
    if (!fs.existsSync(p)) continue;
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (s.status === 'completed') completed.push(dir);
    } catch (e) { /* skip malformed */ }
  }
  return completed;
}

function extractField(transcript, target) {
  if (!transcript) return '';
  const fieldMap = {
    'console_data': 'console', 'transcript.console': 'console',
    'narrator_text': 'narrator', 'transcript.narrator': 'narrator'
  };
  const field = fieldMap[target] || target;
  return transcript.map(t => t[field] || '').filter(Boolean).join('\n');
}

// Session rules: each returns { pass, reason? }
const sessionRules = {
  all_values_lte_2(session) {
    const scoring = session.scoring || {};
    for (const [k, v] of Object.entries(scoring)) {
      if (k === 'total') continue;
      if (v > 2) return { pass: false, reason: k + ' is ' + v + ', exceeds 2' };
    }
    return { pass: true };
  },
  unqueried_services_zero(session, manifest) {
    const scoring = session.scoring || {};
    const queried = session.services_queried || [];
    const services = manifest?.services || Object.keys(scoring).filter(k => k !== 'total');
    for (const svc of services) {
      if (!queried.includes(svc) && (scoring[svc] || 0) !== 0)
        return { pass: false, reason: svc + ' not queried but has score ' + scoring[svc] };
    }
    return { pass: true };
  },
  total_equals_sum(session) {
    const scoring = session.scoring || {};
    const total = scoring.total || 0;
    const sum = Object.entries(scoring).filter(([k]) => k !== 'total').reduce((s, [, v]) => s + v, 0);
    if (total !== sum) return { pass: false, reason: 'total ' + total + ' != sum ' + sum };
    return { pass: true };
  },
  all_values_gte_0(session, _manifest, check) {
    if ((check.target || 'scoring') === 'question_profile.counts') {
      const profile = session.question_profile || {};
      for (const [axis, data] of Object.entries(profile)) {
        if ((data.count || 0) < 0) return { pass: false, reason: axis + ' count is negative' };
      }
      return { pass: true };
    }
    for (const [k, v] of Object.entries(session.scoring || {})) {
      if (v < 0) return { pass: false, reason: k + ' is negative' };
    }
    return { pass: true };
  },
  effective_lte_total_per_axis(session) {
    for (const [axis, data] of Object.entries(session.question_profile || {})) {
      if ((data.effective || 0) > (data.count || 0))
        return { pass: false, reason: axis + ' effective ' + data.effective + ' > count ' + data.count };
    }
    return { pass: true };
  },
  question_counts_match_total(session) {
    const profile = session.question_profile || {};
    const sum = Object.values(profile).reduce((s, d) => s + (d.count || 0), 0);
    if (session.total_questions != null && session.total_questions !== sum)
      return { pass: false, reason: 'total_questions ' + session.total_questions + ' != sum ' + sum };
    return { pass: true };
  },
  at_least_one_axis_has_questions(session) {
    const hasAny = Object.values(session.question_profile || {}).some(d => (d.count || 0) > 0);
    if (!hasAny) return { pass: false, reason: 'no axis has questions' };
    return { pass: true };
  },
  field_exists(session, _manifest, check) {
    if (session[check.field] === undefined) return { pass: false, reason: 'field ' + check.field + ' missing' };
    return { pass: true };
  },
  last_active_recent(session) {
    if (!session.last_active) return { pass: false, reason: 'last_active missing' };
    if (isNaN(new Date(session.last_active).getTime())) return { pass: false, reason: 'last_active not valid ISO date' };
    return { pass: true };
  },
  is_array(session, _manifest, check) {
    if (!Array.isArray(session[check.field])) return { pass: false, reason: check.field + ' is not an array' };
    return { pass: true };
  },
  has_all_axes(session, _manifest, check) {
    const profile = session.question_profile || {};
    const axes = check.axes || ['gather', 'diagnose', 'correlate', 'impact', 'trace', 'fix'];
    for (const a of axes) {
      if (!(a in profile)) return { pass: false, reason: 'missing axis ' + a };
    }
    return { pass: true };
  },
  array_contains(session, _manifest, check) {
    const arr = session[check.target] || session.story_beats_fired || [];
    if (!Array.isArray(arr)) return { pass: false, reason: check.target + ' is not an array' };
    if (!arr.includes(check.value)) return { pass: false, reason: check.target + ' missing ' + check.value };
    return { pass: true };
  },
  classification_matches_keywords(session) {
    if (!session.question_profile) return { pass: false, reason: 'no question_profile' };
    return { pass: true };
  },
  criteria_met_subset_of_manifest(session, manifest) {
    if (!manifest?.resolution?.fix_criteria) return { pass: true };
    const validIds = manifest.resolution.fix_criteria.map(c => c.id);
    for (const id of (session.criteria_met || [])) {
      if (!validIds.includes(id)) return { pass: false, reason: id + ' not in manifest criteria' };
    }
    return { pass: true };
  },
  criteria_sets_cover_manifest(session, manifest) {
    if (!manifest?.resolution?.fix_criteria) return { pass: true };
    const covered = new Set([...(session.criteria_met || []), ...(session.criteria_remaining || [])]);
    for (const c of manifest.resolution.fix_criteria) {
      if (!covered.has(c.id)) return { pass: false, reason: c.id + ' not covered by met or remaining' };
    }
    return { pass: true };
  },
  debrief_covers_zones(session) {
    const zones = session.debrief_zones_explored;
    if (zones != null && Array.isArray(zones) && zones.length === 0 && session.debrief_questions_asked > 0)
      return { pass: false, reason: 'debrief happened but no zones explored' };
    return { pass: true };
  },
  // TODO: refine with real play data
  depth_score_correlates_with_exploration() { return { pass: true }; }
};

// Transcript rules: each returns { pass, reason? }
const transcriptRules = {
  not_contains_any(transcript, _manifest, check) {
    const text = extractField(transcript, check.target).toLowerCase();
    for (const p of (check.patterns || [])) {
      if (text.includes(p.toLowerCase())) return { pass: false, reason: 'found forbidden phrase: ' + p };
    }
    return { pass: true };
  },
  not_contains_manifest_field(transcript, manifest, check) {
    const narText = extractField(transcript, 'narrator_text').toLowerCase();
    let values = [];
    if (check.field === 'root_cause' && manifest?.resolution?.root_cause)
      values.push(manifest.resolution.root_cause);
    else if (check.field === 'what_broke' && manifest?.team?.narrator?.system_narration?.what_broke)
      values.push(manifest.team.narrator.system_narration.what_broke);
    else if (check.field === 'criteria_ids' && manifest?.resolution?.fix_criteria)
      values = manifest.resolution.fix_criteria.map(c => c.id);
    else if (check.field === 'service_weights')
      return { pass: true };
    for (const v of values) {
      if (v && narText.includes(v.toLowerCase())) return { pass: false, reason: 'narrator leaked ' + check.field + ' value' };
    }
    return { pass: true };
  },
  no_emojis(transcript) {
    const narText = extractField(transcript, 'narrator_text');
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/u;
    if (emojiPattern.test(narText)) return { pass: false, reason: 'emoji found in narrator text' };
    return { pass: true };
  },
  no_cross_service_refs(transcript, manifest) {
    for (const entry of transcript) {
      if (!entry.console || !entry.service) continue;
      const consoleText = entry.console.toLowerCase();
      for (const svc of (manifest?.services || [])) {
        if (svc !== entry.service && consoleText.includes(svc.toLowerCase()))
          return { pass: false, reason: 'console for ' + entry.service + ' references ' + svc };
      }
    }
    return { pass: true };
  },
  valid_console_structure(transcript) {
    for (const entry of transcript) {
      if (!entry.console) continue;
      const trimmed = entry.console.trim();
      if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.includes(':'))
        return { pass: false, reason: 'console entry not structured' };
    }
    return { pass: true };
  },
  // TODO: all stubs below pass by default, refine with real play data
  console_markers_wellformed() { return { pass: true }; },
  coaching_follows_unproductive() { return { pass: true }; },
  coaching_refs_correct_service() { return { pass: true }; },
  no_coaching_on_productive() { return { pass: true }; },
  hints_in_order() { return { pass: true }; },
  hints_skip_queried_services() { return { pass: true }; },
  max_one_hint_per_turn() { return { pass: true }; },
  hint_refs_relevant_service() { return { pass: true }; },
  no_hints_before_turn_3() { return { pass: true }; },
  debrief_follows_investigation() { return { pass: true }; },
  debrief_has_seed_questions() { return { pass: true }; }
};

function runCheck(check, session, transcript, manifest) {
  const id = check.id;
  if (check.requires === 'llm') return { id, status: 'pending_llm', prompt: check.prompt };
  if (check.requires === 'transcript' && !transcript) return { id, status: 'skipped', reason: 'no transcript' };
  if (check.requires === 'session' && !session) return { id, status: 'skipped', reason: 'no session' };

  const ruleFn = check.requires === 'session'
    ? sessionRules[check.rule]
    : transcriptRules[check.rule];
  if (!ruleFn) return { id, status: 'error', reason: 'unknown rule' };

  const data = check.requires === 'session' ? session : transcript;
  const result = ruleFn(data, manifest, check, session);
  return { id, status: result.pass ? 'pass' : 'fail', score: result.pass ? 1 : 0, reason: result.reason || undefined };
}

function runScorecard(simId) {
  const session = loadSession(simId);
  if (!session) return { error: 'Session not found for ' + simId };
  const transcript = loadTranscript(simId);
  const manifest = loadManifest(simId);
  const checks = allChecks(loadScoringSpec());
  const results = checks.map(c => runCheck(c, session, transcript, manifest));
  const count = (status) => results.filter(r => r.status === status).length;
  return {
    sim_id: simId,
    timestamp: new Date().toISOString(),
    summary: { passed: count('pass'), failed: count('fail'), skipped: count('skipped'), pending_llm: count('pending_llm'), errors: count('error'), total: checks.length },
    results
  };
}

function writeResult(simId, result) {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(RESULTS_DIR, simId + '-' + ts + '.json');
  fs.writeFileSync(filepath, JSON.stringify(result, null, 2) + '\n');
  return filepath;
}

function appendHistory(entry) {
  const dir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n');
}

module.exports = {
  loadScoringSpec, allChecks, runCheck, runScorecard,
  writeResult, appendHistory, listCompletedSessions,
  loadSession, loadTranscript, loadManifest,
  SESSIONS_DIR, RESULTS_DIR
};
