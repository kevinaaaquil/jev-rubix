'use client';

const money = (n) => (n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(6)}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

const STATUS_LABEL = {
  idle: 'Waiting',
  thinking: '%s is thinking',
  pacing: 'Pacing calls',
  waiting: 'Rate limited — waiting',
  applying: 'Applying moves',
  solved: 'Solved by Kimi',
  stopped: 'Stopped',
  failed: 'Failed',
  broke: 'Out of credit',
};

/** Abort card — mounted only while a solve is in flight. */
export function SolveOverlay({ run, elapsed, onStop, who = 'Kimi' }) {
  const last = run.rounds[run.rounds.length - 1];
  const perMove = run.movesApplied ? run.cost / run.movesApplied : 0;

  return (
    <div className="overlay" role="dialog" aria-label="Kimi solve in progress">
      <div className="overlay-card">
        <div className="overlay-head">
          <span className="pulse" />
          <div>
            <strong>{(STATUS_LABEL[run.status] || '').replace('%s', who)}</strong>
            <span className="overlay-sub">
              {who === 'Jev' ? 'move' : 'attempt'}{' '}
              {run.rounds.length + (run.status === 'waiting' || run.status === 'pacing' ? 0 : 1)} ·{' '}
              {run.model || who.toLowerCase()}
            </span>
          </div>
          <button className="act danger" type="button" onClick={onStop}>
            Abort
          </button>
        </div>

        <div className="overlay-stats">
          <div><span>Solving</span><b>{secs(elapsed)}</b></div>
          <div><span>Moves</span><b>{run.movesApplied}</b></div>
          <div><span>Spent</span><b>{money(run.cost)}</b></div>
          <div><span>Per move</span><b>{run.movesApplied ? money(perMove) : '—'}</b></div>
          <div><span>Last call</span><b>{run.latency ? secs(run.latency) : '—'}</b></div>
          <div><span>Solved stickers</span><b>{last ? `${last.home}/54` : '—'}</b></div>
        </div>

        {run.stage || run.plan ? (
          <p className="overlay-plan">
            {run.stage ? <em>{run.stage}. </em> : null}
            {run.plan}
          </p>
        ) : null}
      </div>
    </div>
  );
}
