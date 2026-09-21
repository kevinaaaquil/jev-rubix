'use client';

import { useCallback, useState } from 'react';

/**
 * Solve records for this tab only — plain React state, no localStorage, no
 * database, nothing sent to the server. A refresh wipes them.
 *
 * A record is written only for a session that began with the Scramble button
 * and ended with the cube solved, whoever did the solving.
 */
export function useStats() {
  const [records, setRecords] = useState([]);

  const add = useCallback((record) => {
    setRecords((list) => [...list, { ...record, id: list.length + 1 }]);
  }, []);

  const clear = useCallback(() => setRecords([]), []);

  return { records, add, clear };
}

export function summarise(records) {
  if (!records.length) {
    return { solves: 0, totalMs: 0, totalMoves: 0, avgMs: 0, avgMoveMs: 0, bestMs: 0, cost: 0, reads: 0, correct: 0 };
  }
  const totalMs = records.reduce((sum, r) => sum + r.durationMs, 0);
  const totalMoves = records.reduce((sum, r) => sum + r.moves, 0);
  return {
    solves: records.length,
    totalMs,
    totalMoves,
    avgMs: totalMs / records.length,
    avgMoveMs: totalMoves ? totalMs / totalMoves : 0,
    bestMs: Math.min(...records.map((r) => r.durationMs)),
    cost: records.reduce((sum, r) => sum + (r.cost || 0), 0),
    reads: records.reduce((sum, r) => sum + (r.reads || 0), 0),
    correct: records.reduce((sum, r) => sum + (r.correct || 0), 0),
  };
}
