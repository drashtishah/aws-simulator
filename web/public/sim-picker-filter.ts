interface SimLite { id: string }
interface SessionLite { sim_id: string; status: string }

export function filterAvailableSims<T extends SimLite>(sims: T[], sessions: SessionLite[]): T[] {
  const completedIds = new Set(
    sessions.filter(s => s.status === 'completed' || s.status === 'post-processing').map(s => s.sim_id)
  );
  return sims.filter(s => !completedIds.has(s.id));
}
