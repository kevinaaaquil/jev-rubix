'use client';

const ms = (n) => `${Math.round(n)} ms`;
const money = (n) => (n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(6)}`);

const STATUS = {
  idle: 'Waiting',
  thinking: '%s is reading the cube',
  pacing: 'Pacing calls',
  waiting: 'Rate limited — waiting',
  applying: 'Playing the algorithm',
  solved: 'Solved',
  stopped: 'Stopped',
  failed: 'Failed',
  broke: 'Out of credit',
};

/** One decision per step: what was asked, what came back, what got played. */
export default function SolveOverlay({ run, elapsed, stageList, onStop, who }) {
  const last = run.steps[run.steps.length - 1];
  const pct = typeof run.probability === 'number' ? Math.round(run.probability * 100) : null;

  return (
    <div className="overlay" role="dialog" aria-label={`${who} solving`}>
      <div className="overlay-card">
        <div className="overlay-head">
          <span className="pulse" />
          <div>
            <strong>{(STATUS[run.status] || '').replace('%s', who)}</strong>
            <span className="overlay-sub">
              step {run.steps.length + (run.status === 'applying' ? 0 : 1)} · {run.model || who.toLowerCase()}
            </span>
          </div>
          <button className="act danger" type="button" onClick={onStop}>
            Abort
          </button>
        </div>

        <div className="decision">
          <p className="decision-prompt">
            <span className="caret">&gt;</span> {run.stage || 'starting'}
            {run.subject ? <span className="decision-subject"> · {run.subject}</span> : null}
          </p>

          {run.answer ? (
            <p className={run.wasCorrect === false ? 'decision-read wrong' : 'decision-read'}>
              <span className="tick">{run.wasCorrect === false ? '✗' : '✓'}</span>
              <span className="decision-text">{run.answer}</span>
              {pct !== null ? (
                <>
                  <span className="prob-bar" aria-hidden="true">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="prob-value">{(pct / 100).toFixed(2)}</span>
                </>
              ) : null}
            </p>
          ) : null}

          {run.algorithm ? (
            <p className="decision-alg">
              <span className="arrow">&rarr;</span> {run.algorithm}
              {last?.latency ? <span className="decision-ms">{ms(last.latency)}</span> : null}
            </p>
          ) : null}
        </div>

        <ol className="stage-list">
          {stageList.map((s) => (
            <li key={s.key} className={s.done ? 'done' : s.current ? 'current' : ''}>
              <span className="stage-mark">{s.done ? '✓' : s.current ? '▸' : '·'}</span>
              {s.name}
            </li>
          ))}
        </ol>

        <div className="overlay-stats">
          <div><span>Solving</span><b>{(elapsed / 1000).toFixed(1)}s</b></div>
          <div><span>Moves</span><b>{run.movesApplied}</b></div>
          <div><span>Reads right</span><b>{run.reads ? `${run.correct}/${run.reads}` : '—'}</b></div>
          <div><span>Spent</span><b>{money(run.cost)}</b></div>
        </div>
      </div>
    </div>
  );
}
