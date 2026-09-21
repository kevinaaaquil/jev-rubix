'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_WAITS = 6;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function backoff(attempt, suggested) {
  const stepped = MIN_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(Math.max(stepped, suggested || 0, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
}

const IDLE = {
  status: 'idle', // idle | thinking | applying | waiting | solved | stopped | failed | broke
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
 * Jev answers one typed question at a time, so the solve is a policy loop:
 * ask which face turn to play, play it, ask again from the new state.
 */
export function useJevSolver(sceneRef, { maxMoves = 80, budget = 0.05 } = {}) {
  const [run, setRun] = useState(IDLE);
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);

  const running = ['thinking', 'applying', 'waiting'].includes(run.status);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setElapsed(Date.now() - (run.runStartedAt || run.startedAt)), 100);
    return () => clearInterval(id);
  }, [running, run.runStartedAt, run.startedAt]);

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

    const nap = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (cancelledRef.current) return false;
        await new Promise((r) => setTimeout(r, 200));
      }
      return true;
    };

    let waits = 0;
    let lastMove = '';
    for (let round = 1; round <= maxMoves; round++) {
      if (cancelledRef.current) break;

      const snapshot = scene.snapshot();
      if (snapshot.stickersHome === 54) break;

      const controller = new AbortController();
      abortRef.current = controller;
      commit({ status: 'thinking' });

      let payload;
      const t0 = Date.now();
      try {
        const res = await fetch('/api/jev', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            facelets: snapshot.facelets,
            stickersHome: snapshot.stickersHome,
            lastMove,
          }),
        });
        payload = await res.json();
        if (res.status === 429 && payload?.rateLimited && waits < MAX_WAITS) {
          waits += 1;
          abortRef.current = null;
          commit({ status: 'waiting', error: '' });
          if (!(await nap(backoff(waits, payload.retryAfterMs)))) break;
          round -= 1;
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
        commit({ status: 'failed', error: 'Network error talking to Jev.', endedAt: Date.now() });
        abortRef.current = null;
        return;
      }
      abortRef.current = null;
      if (cancelledRef.current) break;

      waits = 0;
      const move = payload.move;
      if (!move) {
        commit({ status: 'stopped', error: 'Jev returned no usable move.', endedAt: Date.now() });
        return;
      }

      lastMove = move.token;
      const latency = payload.ms ?? Date.now() - t0;
      const confidence =
        typeof move.probability === 'number'
          ? `${Math.round(move.probability * 100)}% of the distribution`
          : typeof move.confidence === 'number'
            ? `confidence ${move.confidence.toFixed(2)}`
            : '';

      commit({ status: 'applying', stage: move.token, plan: confidence });
      await scene.applyMoves([move]);

      const after = scene.snapshot();
      const entry = {
        round,
        moves: move.token,
        count: 1,
        rejected: 0,
        latency,
        cost: payload.cost || 0,
        promptTokens: payload.usage?.input_tokens || 0,
        completionTokens: payload.usage?.output_tokens || 0,
        cachedTokens: 0,
        home: after.stickersHome,
        stage: move.token,
      };

      state = commit({
        rounds: [...state.rounds, entry],
        movesApplied: state.movesApplied + 1,
        promptTokens: state.promptTokens + entry.promptTokens,
        completionTokens: state.completionTokens + entry.completionTokens,
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
    }

    if (cancelledRef.current) commit({ status: 'stopped', error: 'Aborted.', endedAt: Date.now() });
    else if (scene.snapshot().stickersHome === 54) commit({ status: 'solved', endedAt: Date.now() });
    else commit({ status: 'stopped', error: `Gave up after ${maxMoves} moves.`, endedAt: Date.now() });
  }, [sceneRef, running, maxMoves, budget, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const thinkMs = run.rounds.reduce((sum, r) => sum + r.latency, 0);
  return { run, running, elapsed, thinkMs, solve, stop, beginSession };
}
