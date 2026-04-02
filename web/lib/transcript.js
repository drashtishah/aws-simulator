// web/lib/transcript.js
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

let sessionsDir = paths.SESSIONS_DIR;

function appendTurn(simId, turn) {
  const dir = path.join(sessionsDir, simId);
  fs.mkdirSync(dir, { recursive: true });
  const entry = {
    turn: turn.turn,
    ts: new Date().toISOString(),
    player: turn.player || null,
    narrator: turn.narrator || null,
    console: turn.console || null,
    coaching: turn.coaching || null,
    mode: turn.mode || 'narrator',
    service: turn.service || null
  };
  fs.appendFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify(entry) + '\n');
}

function readTranscript(simId) {
  const file = path.join(sessionsDir, simId, 'transcript.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function hasTranscript(simId) {
  return fs.existsSync(path.join(sessionsDir, simId, 'transcript.jsonl'));
}

// For testing: override sessions directory
function _setSessionsDir(dir) { sessionsDir = dir; }

module.exports = { appendTurn, readTranscript, hasTranscript, _setSessionsDir };
