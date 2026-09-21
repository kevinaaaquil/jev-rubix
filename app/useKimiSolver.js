'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_WAITS = 8;
// The account allows roughly three calls a minute, so leave this much room
// between the start of one call and the next. Cheaper than being refused.
const MIN_GAP_MS = 20_000;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

/** 5s, 10s, 20s, 40s, 60s… never shorter than what the server suggested. */
function backoff(attempt, suggested) {
  const stepped = MIN_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(Math.max(stepped, suggested || 0, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
}

const IDLE = {
  status: 'idle', // idle | thinking | pacing | waiting | applying | solved | stopped | failed | broke
  rounds: [],
  movesApplied: 0,
  rejected: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  cost: 0,
  latency: 0,
  startedAt: 0,
  runStartedAt: 0,
  endedAt: 0,
  model: '',
  rates: null,
  stage: '',
  plan: '',
  error: '',
  best: 0,
};

/**
 * Runs the solve loop: each round posts the current sticker state (never the
 * move log) and applies whatever legal moves come back.
 */
export function useKimiSolver(sceneRef, { maxRounds = 10, batchSize = 80, budget = 0.25, minGapMs = MIN_GAP_MS } = {}) {
  const [run, setRun] = useState(IDLE);
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const running = ['thinking', 'pacing', 'waiting', 'applying'].includes(run.status);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed(Date.now() - (run.runStartedAt || run.startedAt)), 100);
    return () => clearInterval(id);
  }, [running, run.runStartedAt, run.startedAt]);

  /** Called when a new scramble starts a fresh stats session. */
  const beginSession = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    setRun(IDLE);
    setElapsed(0);
  }, []);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.abort();
    sceneRef.current?.stopQueue();
  }, [sceneRef]);

  const reset = useCallback(() => {
    stop();
    setRun(IDLE);
    setElapsed(0);
  }, [stop]);

  const solve = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || running) return;

    cancelledRef.current = false;
    const startedAt = Date.now();
    let state = {
      ...run,
      status: 'thinking',
      error: '',
      endedAt: 0,
      startedAt: run.startedAt || startedAt,
      runStartedAt: startedAt,
      best: Math.max(run.best, scene.snapshot().stickersHome),
    };
    setRun(state);
    setElapsed(0);

    const commit = (patch) => {
      state = { ...state, ...patch };
      setRun(state);
      return state;
    };

    // Interruptible sleep, so Abort still lands while we are waiting out a limit.
    const nap = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (cancelledRef.current) return false;
        await new Promise((r) => setTimeout(r, 200));
      }
      return true;
    };

    let waits = 0;
    let lastCallAt = 0;
    for (let round = 1; round <= maxRounds; round++) {
      if (cancelledRef.current) break;

      // Space the calls out rather than getting refused and retrying.
      const since = Date.now() - lastCallAt;
      if (lastCallAt && since < minGapMs) {
        commit({ status: 'pacing' });
        if (!(await nap(minGapMs - since))) break;
      }

      const snapshot = scene.snapshot();
      if (snapshot.stickersHome === 54) break;

      const controller = new AbortController();
      abortRef.current = controller;
      commit({ status: 'thinking' });

      let payload;
      const t0 = Date.now();
      lastCallAt = t0;
      try {
        const res = await fetch('/api/solve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            facelets: snapshot.facelets,
            stickersHome: snapshot.stickersHome,
            maxMoves: batchSize,
          }),
        });
        payload = await res.json();
        if (res.status === 429 && payload?.rateLimited && waits < MAX_WAITS) {
          waits += 1;
          abortRef.current = null;
          commit({ status: 'waiting', error: '' });
          const slept = await nap(backoff(waits, payload.retryAfterMs));
          if (!slept) break;
          round -= 1; // the round never happened
          continue;
        }
        if (!res.ok) {
          commit({
            status: payload?.walletEmpty ? 'broke' : 'failed',
            error: payload?.error || `Request failed (${res.status}).`,
            endedAt: Date.now(),
          });
          abortRef.current = null;
          return;
        }
      } catch (err) {
        if (cancelledRef.current || err?.name === 'AbortError') break;
        commit({ status: 'failed', error: 'Network error talking to the solver.', endedAt: Date.now() });
        abortRef.current = null;
        return;
      }
      abortRef.current = null;
      if (cancelledRef.current) break;

      waits = 0; // a round landed, so the limiter budget starts over
      const latency = payload.ms ?? Date.now() - t0;
      const moves = payload.moves || [];

      commit({ status: 'applying', stage: payload.stage || '', plan: payload.plan || '' });
      await scene.applyMoves(moves);

      const after = scene.snapshot();
      const entry = {
        round,
        moves: moves.map((m) => m.token).join(' '),
        count: moves.length,
        rejected: (payload.rejected || []).length,
        latency,
        cost: payload.cost || 0,
        promptTokens: payload.usage?.prompt_tokens || 0,
        completionTokens: payload.usage?.completion_tokens || 0,
        cachedTokens: payload.usage?.cached_tokens || 0,
        home: after.stickersHome,
        stage: payload.stage || '',
      };

      state = commit({
        rounds: [...state.rounds, entry],
        movesApplied: state.movesApplied + moves.length,
        rejected: state.rejected + entry.rejected,
        promptTokens: state.promptTokens + entry.promptTokens,
        completionTokens: state.completionTokens + entry.completionTokens,
        cachedTokens: state.cachedTokens + entry.cachedTokens,
        cost: state.cost + entry.cost,
        latency,
        model: payload.model || state.model,
        rates: payload.rates || state.rates,
        best: Math.max(state.best, after.stickersHome),
      });

      if (after.stickersHome === 54) {
        commit({ status: 'solved', endedAt: Date.now() });
        return;
      }
      if (state.cost >= budget) {
        commit({ status: 'stopped', error: `Stopped at the $${budget.toFixed(2)} budget.`, endedAt: Date.now() });
        return;
      }
      if (moves.length === 0 && entry.rejected === 0) {
        commit({ status: 'stopped', error: 'Kimi returned no usable moves.', endedAt: Date.now() });
        return;
      }
    }

    if (cancelledRef.current) commit({ status: 'stopped', error: 'Aborted.', endedAt: Date.now() });
    else if (scene.snapshot().stickersHome === 54) commit({ status: 'solved', endedAt: Date.now() });
    else commit({ status: 'stopped', error: `Gave up after ${maxRounds} rounds.`, endedAt: Date.now() });
  }, [sceneRef, running, maxRounds, batchSize, budget, minGapMs, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Compute time spent inside Kimi rounds, independent of the wall clock.
  const thinkMs = run.rounds.reduce((sum, r) => sum + r.latency, 0);
  return { run, running, elapsed, thinkMs, solve, stop, reset, beginSession };
}
