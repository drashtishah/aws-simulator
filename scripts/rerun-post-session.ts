import { runPostSessionAgent } from './post-session-orchestrator.js';

const simId = process.argv[2];
if (!simId) {
  console.error('Usage: tsx scripts/rerun-post-session.ts <sim-id>');
  process.exit(1);
}

console.log(`Running post-session for ${simId}...`);
runPostSessionAgent(simId).then(result => {
  console.log(`Done. tier1=${result.tier1_duration_ms}ms tier2=${result.tier2_duration_ms}ms`);
}).catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
