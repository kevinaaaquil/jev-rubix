'use client';

import { summarise } from './useStats';

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
const clock = (ms) => {
  const total = Math.round(ms / 100) / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  const m = Math.floor(total / 60);
  return `${m}m ${(total - m * 60).toFixed(1)}s`;
};
const money = (n) => (n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(6)}`);

const SOLVER_LABEL = {
  you: 'You',
  kimi: 'Kimi',
  jev: 'Jev',
  both: 'You + Kimi',
  mixed: 'Mixed',
};

export default function StatsModal({ records, onClose, onClear }) {
  const totals = summarise(records);
  const empty = records.length === 0;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Solve stats">
      <button className="modal-scrim" type="button" aria-label="Close stats" onClick={onClose} />
      <div className="modal-card">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Session memory · this tab only</p>
            <h2>Solve stats</h2>
          </div>
          <div className="modal-actions">
            <button className="act danger" type="button" onClick={onClear} disabled={empty}>
              Clear stats
            </button>
            <button className="act" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {empty ? (
          <p className="modal-empty">
            No solves recorded yet. Hit <b>Scramble</b>, then solve the cube by hand or with Kimi —
            that round trip is what gets measured.
          </p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="hl"><span>Total solve time</span><b>{clock(totals.totalMs)}</b></div>
              <div className="hl"><span>Average move time</span><b>{Math.round(totals.avgMoveMs)}ms</b></div>
              <div><span>Solves</span><b>{totals.solves}</b></div>
              <div><span>Total moves</span><b>{totals.totalMoves}</b></div>
              <div><span>Average solve</span><b>{clock(totals.avgMs)}</b></div>
              <div><span>Best solve</span><b>{clock(totals.bestMs)}</b></div>
              {totals.cost > 0 ? <div><span>Model spend</span><b>{money(totals.cost)}</b></div> : null}
            </div>

            <div className="round-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Solved by</th>
                    <th className="num">Time</th>
                    <th className="num">Moves</th>
                    <th className="num">Avg / move</th>
                    <th className="num">You</th>
                    <th className="num">Kimi</th>
                    <th className="num">Jev</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{SOLVER_LABEL[r.solvedBy]}</td>
                      <td className="num">{clock(r.durationMs)}</td>
                      <td className="num">{r.moves}</td>
                      <td className="num">{r.moves ? `${Math.round(r.avgMoveMs)}ms` : '—'}</td>
                      <td className="num">{r.yourMoves}</td>
                      <td className="num">{r.kimiMoves}</td>
                      <td className="num">{r.jevMoves ?? 0}</td>
                      <td className="num">{r.cost ? money(r.cost) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totals.cost > 0 ? (
              <p className="kimi-rates">
                Model calls: {records.reduce((sum, r) => sum + (r.rounds || 0), 0)} · API time{' '}
                {secs(records.reduce((sum, r) => sum + (r.thinkMs || 0), 0))} · tokens{' '}
                {records.reduce((sum, r) => sum + (r.tokens || 0), 0).toLocaleString()}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
