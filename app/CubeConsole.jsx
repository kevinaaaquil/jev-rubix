'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AMOUNTS,
  COLOR,
  FACE_NAME,
  FACE_ORDER,
  TURN,
  notation,
  solutionFromHistory,
} from '../lib/cube';
import { CubeScene } from '../lib/cube-scene';
import SolveOverlay from './SolveOverlay';
import StatsModal from './StatsModal';
import { useStats } from './useStats';
import { useSolver } from './useSolver';

const SPEED_BASE = 580; // slider is inverted: higher slider value = shorter turn

// The move log and undo are a hidden feature: triple-click the bottom-right
// corner to reveal them. The only hint is a faint gradient in that corner.

// A session exists only between the Scramble button and the cube coming back
// solved. Turning a solved cube by hand does not open one, so it is never timed.
const NO_SESSION = { open: false, startedAt: 0, baseline: 0 };

export default function CubeConsole() {
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const tapeRef = useRef(null);
  const [state, setState] = useState({ history: [], solved: true, busy: false });
  const [slider, setSlider] = useState(360);
  const [revealed, setRevealed] = useState(false);
  const duration = SPEED_BASE - slider;

  useEffect(() => {
    const scene = new CubeScene(stageRef.current, setState);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setDuration(duration);
  }, [duration]);

  useEffect(() => {
    const tape = tapeRef.current;
    if (tape) tape.scrollLeft = tape.scrollWidth;
  }, [state.history.length, revealed]);

  // Same loop, same question, same algorithms — only the model differs.
  // Moonshot allows a few calls a minute, so Kimi's turns are paced.
  const kimi = useSolver(sceneRef, { endpoint: '/api/solve', who: 'Kimi', minGapMs: 20_000 });
  const jev = useSolver(sceneRef, { endpoint: '/api/jev', who: 'Jev' });
  const running = kimi.running || jev.running;
  const active = jev.running ? jev : kimi;
  const [session, setSession] = useState(NO_SESSION);
  const [statsOpen, setStatsOpen] = useState(false);
  const stats = useStats();

  const startSession = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    kimi.beginSession();
    jev.beginSession();
    scene.scramble();
    setSession({
      open: true,
      startedAt: Date.now(),
      baseline: scene.turns, // the scramble itself is not a turn, so it never counts
    });
  }, [kimi, jev]);

  // Reset abandons the session: no record, nothing timed.
  const endSession = useCallback(() => {
    sceneRef.current?.reset();
    kimi.beginSession();
    jev.beginSession();
    setSession(NO_SESSION);
  }, [kimi, jev]);

  // The cube came back solved inside a session — record it, whoever got it there.
  useEffect(() => {
    if (!session.open || !state.solved) return;
    const scene = sceneRef.current;
    const durationMs = Date.now() - session.startedAt;
    const total = Math.max(0, (scene ? scene.turns : 0) - session.baseline);
    const kimiMoves = Math.min(kimi.run.movesApplied, total);
    const jevMoves = Math.min(jev.run.movesApplied, total - kimiMoves);
    const yourMoves = total - kimiMoves - jevMoves;
    const byModel = (kimiMoves ? 1 : 0) + (jevMoves ? 1 : 0);
    stats.add({
      at: Date.now(),
      durationMs,
      moves: total,
      avgMoveMs: total ? durationMs / total : 0,
      yourMoves,
      kimiMoves,
      jevMoves,
      solvedBy:
        byModel > 1 || (byModel && yourMoves)
          ? byModel > 1
            ? 'mixed'
            : 'both'
          : kimiMoves
            ? 'kimi'
            : jevMoves
              ? 'jev'
              : 'you',
      cost: kimi.run.cost + jev.run.cost,
      rounds: kimi.run.steps.length + jev.run.steps.length,
      thinkMs: kimi.thinkMs + jev.thinkMs,
      reads: kimi.run.reads + jev.run.reads,
      correct: kimi.run.correct + jev.run.correct,
      tokens:
        kimi.run.promptTokens + kimi.run.completionTokens + jev.run.promptTokens + jev.run.completionTokens,
    });
    setSession(NO_SESSION);
    kimi.beginSession();
    jev.beginSession();
  }, [state.solved, session, kimi, jev, stats]);

  const turn = useCallback((face, amount) => sceneRef.current?.push(face, amount), []);

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (statsOpen) {
        if (e.key === 'Escape') setStatsOpen(false);
        return;
      }
      if (e.key === 'Escape' && running) {
        e.preventDefault();
        active.stop();
        return;
      }
      if (running) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const key = e.key.toUpperCase();
      if (TURN[key]) {
        e.preventDefault();
        turn(key, e.shiftKey ? -1 : 1);
      } else if (key === 'S') {
        e.preventDefault();
        sceneRef.current?.scramble();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        sceneRef.current?.undo();
      } else if (e.key === 'Escape') {
        endSession();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, running, active, endSession, statsOpen]);

  const shown = state.history.slice(-60);
  // Rewinding the log always solves the cube, however it got into this state.
  const solution = revealed ? solutionFromHistory(state.history) : [];

  const playSolution = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.applyMoves(solutionFromHistory(scene.history));
  }, []);

  return (
    <div className="wrap">
      <header>
        <div>
          <p className="eyebrow">3×3×3 · Singmaster notation</p>
          <h1>Rubik&rsquo;s Cube Console</h1>
        </div>
        <div className="status">
          <span className={state.solved ? 'chip solved' : 'chip'}>
            <span className="dot" />
            {state.solved ? 'Solved' : 'Scrambled'}
          </span>
          <span className="chip">
            Moves <b>{state.history.length}</b>
          </span>
        </div>
      </header>

      <div className="board">
        <div className="card stage-card">
          <div className="stage" ref={stageRef} />
          <div className="stage-foot">
            <span className="hint">Drag the cube to look around</span>
            <div className="view-btns">
              <button className="mini" type="button" onClick={() => sceneRef.current?.home()}>
                Reset view
              </button>
              <button className="mini" type="button" onClick={() => sceneRef.current?.back()}>
                Show back
              </button>
            </div>
          </div>
          {revealed ? (
            <div className="tape solution">
              <span className="lbl">Solve</span>
              <div className="tape-scroll">
                <div className="tape-inner">
                  {solution.length === 0 ? (
                    <span className="tape-empty">already solved</span>
                  ) : (
                    solution.map((m, i) => (
                      <span className="tk sol" key={`s${i}-${m.face}-${m.amount}`}>
                        {notation(m)}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <span className="sol-count">{solution.length}</span>
              <button
                className="mini"
                type="button"
                disabled={running || solution.length === 0}
                onClick={playSolution}
              >
                Play
              </button>
            </div>
          ) : null}
          {revealed ? (
            <div className="tape">
              <span className="lbl">Log</span>
              <div className="tape-scroll" ref={tapeRef}>
                <div className="tape-inner">
                  {shown.length === 0 ? (
                    <span className="tape-empty">no moves yet</span>
                  ) : (
                    shown.map((m, i) => (
                      <span className="tk" key={`${i}-${m.face}-${m.amount}`}>
                        {notation(m)}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card console">
          <p className="sect-title">Face turns</p>
          <div className="moves">
            {FACE_ORDER.map((face) => (
              <div className="grp" key={face}>
                <div className="grp-head">
                  <span className="swatch" style={{ background: COLOR[face] }} />
                  <span className="grp-name">{FACE_NAME[face]}</span>
                </div>
                <div className="grp-btns">
                  {AMOUNTS.map((amount) => (
                    <button
                      className="mv"
                      type="button"
                      key={amount}
                      disabled={running}
                      onClick={() => turn(face, amount)}
                      title={`${FACE_NAME[face]} ${
                        amount === 1 ? 'clockwise' : amount === -1 ? 'counter-clockwise' : 'half turn'
                      }`}
                    >
                      {notation({ face, amount })}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="solvers">
            <button
              className="act solve-kimi"
              type="button"
              onClick={kimi.solve}
              disabled={running || state.solved}
              title={state.solved ? 'Scramble first' : 'Kimi reads the cube, one question per step'}
            >
              Solve using Kimi
            </button>
            <button
              className="act solve-jev"
              type="button"
              onClick={jev.solve}
              disabled={running || state.solved}
              title={state.solved ? 'Scramble first' : 'Jev reads the cube, one question per step'}
            >
              Solve using Jev
            </button>
          </div>

          {[kimi.run, jev.run].map((r, i) =>
            r.error ? (
              <p key={i} className={r.status === 'broke' ? 'kimi-error broke' : 'kimi-error'}>
                {r.error}
              </p>
            ) : null
          )}

          <p className="sect-title">Controls</p>
          <div className="util">
            <button className="act primary" type="button" disabled={running} onClick={startSession}>
              Scramble
            </button>
            {revealed ? (
              <button
                className="act"
                type="button"
                disabled={running || state.history.length === 0}
                onClick={() => sceneRef.current?.undo()}
              >
                Undo
              </button>
            ) : null}
            <button
              className="act"
              type="button"
              disabled={running}
              onClick={endSession}
            >
              Reset
            </button>
            <button
              className="act"
              type="button"
              onClick={() => setStatsOpen(true)}
              title={stats.records.length ? 'Solve times for this tab' : 'solve atleast once for stats'}
            >
              Stats{stats.records.length ? ` (${stats.records.length})` : ''}
            </button>
          </div>

          <div className="speed">
            <label htmlFor="speed">Speed</label>
            <input
              id="speed"
              type="range"
              min="60"
              max="520"
              step="20"
              value={slider}
              onChange={(e) => setSlider(Number(e.target.value))}
            />
            <output>{duration}ms</output>
          </div>

          <div className="keys">
            <kbd>U</kbd> <kbd>D</kbd> <kbd>L</kbd> <kbd>R</kbd> <kbd>F</kbd> <kbd>B</kbd> turn a face
            <br />
            <kbd>Shift</kbd> + letter turns counter-clockwise
            <br />
            <kbd>S</kbd> scramble · <kbd>Esc</kbd> reset, or abort a solve
          </div>
        </div>

      </div>

      {running ? (
        <SolveOverlay
          run={active.run}
          elapsed={active.elapsed}
          stageList={active.stageList}
          onStop={active.stop}
          who={active.who}
        />
      ) : null}

      <button
        className="hotspot"
        type="button"
        aria-label={revealed ? 'Hide the move log and undo' : 'Show the move log and undo'}
        title="Triple-click"
        onClick={(e) => {
          if (e.detail === 3) setRevealed((v) => !v);
        }}
      />

      {statsOpen ? (
        <StatsModal
          records={stats.records}
          onClear={stats.clear}
          onClose={() => setStatsOpen(false)}
        />
      ) : null}
    </div>
  );
}
