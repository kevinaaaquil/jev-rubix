'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMove } from '../lib/cube';
import { applySeq, fromFacelets, isSolvedState } from '../lib/facelets';
import { STAGES, nextCandidates } from '../lib/beginner';
import { buildQuestion } from '../lib/questions';

const MAX_WAITS = 8;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

function backoff(attempt, suggested) {
  const stepped = MIN_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(Math.max(stepped, suggested || 0, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
}

export const IDLE = {
  status: 'idle', // idle | thinking | pacing | waiting | applying | solved | stopped | failed | broke
  steps: [],
  movesApplied: 0,
  reads: 0,
  correct: 0,
  promptTokens: 0,
  completionTokens: 0,
  cost: 0,
  latency: 0,
  startedAt: 0,
  runStartedAt: 0,
  endedAt: 0,
  model: '',
  rates: null,
  stage: '',
  subject: '',
  answer: '',
  probability: null,
  wasCorrect: null,
  algorithm: '',
  error: '',
};

/**
 * The beginner's method runs here, in the page. At every step the model is
 * asked one typed question — read the cube — and the code checks the answer
 * against what it already knows before playing the algorithm for that case.
 * The model's reading never decides whether the cube gets solved, only how
 * well it saw the position.
 */
export function useSolver(sceneRef, { endpoint, who, maxSteps = 40, budget = 0.25, minGapMs = 0 } = {}) {
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
      ...IDLE,
      status: 'thinking',
      startedAt,
      runStartedAt: startedAt,
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

    let cube = fromFacelets(scene.snapshot().facelets);
    let waits = 0;
    let lastCallAt = 0;

    for (let step = 1; step <= maxSteps; step++) {
      if (cancelledRef.current || isSolvedState(cube)) break;

      const { stage, candidates } = nextCandidates(cube);
      if (!stage || !candidates.length) {
        commit({ status: 'stopped', error: 'The solver ran out of continuations.', endedAt: Date.now() });
        return;
      }

      const question = buildQuestion(cube, stage);
      const options = question ? Object.entries(question.options).map(([key, text]) => ({ key, text })) : [];
      const play = candidates[0];

      let answer = null;
      let payload = {};

      if (question && options.length > 1) {
        const since = Date.now() - lastCallAt;
        if (lastCallAt && since < minGapMs) {
          commit({ status: 'pacing' });
          if (!(await nap(minGapMs - since))) break;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        commit({ status: 'thinking', stage: stage.name, subject: question.subject, answer: '', wasCorrect: null });

        const t0 = Date.now();
        lastCallAt = t0;
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              facelets: scene.snapshot().facelets,
              stage: { key: stage.key, name: stage.name },
              subject: question.subject,
              prompt: question.prompt,
              options, // the truth stays here, in the browser
            }),
          });
          payload = await res.json();
          if (res.status === 429 && payload?.rateLimited && waits < MAX_WAITS) {
            waits += 1;
            abortRef.current = null;
            commit({ status: 'waiting', error: '' });
            if (!(await nap(backoff(waits, payload.retryAfterMs)))) break;
            step -= 1;
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
          commit({ status: 'failed', error: `Network error talking to ${who}.`, endedAt: Date.now() });
          abortRef.current = null;
          return;
        }
        abortRef.current = null;
        if (cancelledRef.current) break;
        waits = 0;
        answer = payload.key ?? null;
      }

      const correct = answer === null ? null : answer === question.truth;
      const answerText = answer && question.options[answer] ? question.options[answer] : '';

      commit({
        status: 'applying',
        stage: stage.name,
        subject: question ? question.subject : '',
        answer: answerText,
        probability: payload.probability ?? null,
        wasCorrect: correct,
        algorithm: play.moves.join(' '),
      });

      await scene.applyMoves(play.moves.map(parseMove));
      cube = applySeq(cube, play.moves);

      const entry = {
        step,
        stage: stage.key,
        stageName: stage.name,
        subject: question ? question.subject : '',
        asked: Boolean(answer !== null),
        answer: answerText,
        truth: question ? question.options[question.truth] : '',
        correct,
        probability: payload.probability ?? null,
        latency: payload.ms ?? 0,
        cost: payload.cost || 0,
        promptTokens: payload.usage?.input_tokens ?? payload.usage?.prompt_tokens ?? 0,
        completionTokens: payload.usage?.output_tokens ?? payload.usage?.completion_tokens ?? 0,
        moves: play.moves.join(' '),
        count: play.moves.length,
      };

      state = commit({
        steps: [...state.steps, entry],
        movesApplied: state.movesApplied + entry.count,
        reads: state.reads + (entry.asked ? 1 : 0),
        correct: state.correct + (correct === true ? 1 : 0),
        promptTokens: state.promptTokens + entry.promptTokens,
        completionTokens: state.completionTokens + entry.completionTokens,
        cost: state.cost + entry.cost,
        latency: entry.latency || state.latency,
        model: payload.model || state.model,
        rates: payload.rates || state.rates,
      });

      if (isSolvedState(cube)) {
        commit({ status: 'solved', endedAt: Date.now() });
        return;
      }
      if (state.cost >= budget) {
        commit({ status: 'stopped', error: `Stopped at the $${budget.toFixed(2)} budget.`, endedAt: Date.now() });
        return;
      }
    }

    if (cancelledRef.current) commit({ status: 'stopped', error: 'Aborted.', endedAt: Date.now() });
    else if (isSolvedState(cube)) commit({ status: 'solved', endedAt: Date.now() });
    else commit({ status: 'stopped', error: `Gave up after ${maxSteps} steps.`, endedAt: Date.now() });
  }, [sceneRef, running, endpoint, who, maxSteps, budget, minGapMs, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const thinkMs = run.steps.reduce((sum, s) => sum + s.latency, 0);
  const stageList = STAGES.map((s) => ({
    key: s.key,
    name: s.name,
    done: run.steps.some((step) => STAGES.findIndex((x) => x.key === step.stage) > STAGES.findIndex((x) => x.key === s.key)),
    current: run.stage === s.name,
  }));

  return { run, running, elapsed, thinkMs, stageList, solve, stop, beginSession, who };
}
