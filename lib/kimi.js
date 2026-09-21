// Prompt building, response parsing and pricing for the Kimi solve loop.
// Pure functions only — the API key never enters this file.
import { parseMove } from './cube';

// Cheapest model this account can reach (GET /v1/models lists what a key allows).
export const DEFAULT_MODEL = 'kimi-k2.6';

// USD per 1M tokens. Moonshot's published rates; override per-model with
// KIMI_PRICE_IN / KIMI_PRICE_CACHED / KIMI_PRICE_OUT if your account differs.
export const PRICES = {
  'kimi-k2.6': { in: 0.95, cached: 0.16, out: 4.0 },
  'kimi-k2.7-code': { in: 0.95, cached: 0.19, out: 4.0 },
  'kimi-k2.7-code-highspeed': { in: 1.9, cached: 0.38, out: 8.0 },
  'kimi-k3': { in: 3.0, cached: 0.3, out: 15.0 },
};

export function ratesFor(model, env = {}) {
  const base = PRICES[model] || PRICES[DEFAULT_MODEL];
  const num = (v, fallback) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback);
  return {
    in: num(env.KIMI_PRICE_IN, base.in),
    cached: num(env.KIMI_PRICE_CACHED, base.cached),
    out: num(env.KIMI_PRICE_OUT, base.out),
  };
}

export function costOf(usage, rates) {
  const cached = usage.cached_tokens || 0;
  const fresh = Math.max(0, (usage.prompt_tokens || 0) - cached);
  return (
    (fresh * rates.in + cached * rates.cached + (usage.completion_tokens || 0) * rates.out) / 1e6
  );
}

const FACE_LETTERS = 'UDLRFB';

/** Guard the one value the client controls: 54 characters of UDLRFB. */
export function validFacelets(s) {
  if (typeof s !== 'string' || s.length !== 54) return null;
  const counts = {};
  for (const ch of s) {
    if (!FACE_LETTERS.includes(ch)) return null;
    counts[ch] = (counts[ch] || 0) + 1;
  }
  return FACE_LETTERS.split('').every((f) => counts[f] === 9) ? s : null;
}

const SLICES = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

function rows(facelets, face) {
  const start = SLICES[face];
  const s = facelets.slice(start, start + 9);
  return [s.slice(0, 3), s.slice(3, 6), s.slice(6, 9)];
}

/** An unfolded net, drawn server-side from the validated string. */
export function netDiagram(facelets) {
  const r = (f) => rows(facelets, f);
  const pad = '       ';
  const lines = [];
  for (const row of r('U')) lines.push(pad + row.split('').join(' '));
  lines.push('');
  for (let i = 0; i < 3; i++) {
    lines.push(
      [r('L')[i], r('F')[i], r('R')[i], r('B')[i]].map((x) => x.split('').join(' ')).join('   ')
    );
  }
  lines.push('');
  for (const row of r('D')) lines.push(pad + row.split('').join(' '));
  return lines.join('\n');
}

export const SYSTEM_PROMPT = [
  'You are a Rubik\'s Cube solving engine. You receive only the current sticker state of a',
  '3x3x3 cube — never the moves that produced it, so it cannot be undone by backtracking.',
  '',
  'Notation: U D L R F B turn that face 90° clockwise (looking at the face from outside).',
  "A prime (U') is counter-clockwise, a 2 (U2) is a half turn. No slice, wide or rotation moves.",
  '',
  'Sticker letters name the face a sticker belongs to when solved: U, D, L, R, F, B.',
  'The net is drawn as Up on top, then Left Front Right Back in a band, then Down.',
  'Centres never move, so a face is solved when all nine of its stickers match its centre.',
  '',
'Return a COMPLETE solution: the whole sequence that takes this exact state to a',
  'solved cube, worked out move by move in your head before you answer. Do not stop',
  'at a stage. Do not hand back a hint or a partial idea.',
  '',
  'Work it the way a human does — cross, first two layers, orient the last layer,',
  'permute the last layer — but give every move of every stage in one list.',
  '',
  'If the cube is still unsolved after your sequence is played, you will be shown the',
  'new state and asked again, with no memory of this attempt. So make each answer a',
  'standalone, complete solve attempt from the state in front of you.',
  '',
  'Reply with JSON only: {"moves": ["R", "U\'", "F2"], "stage": "short label", "plan": "one sentence"}',
].join('\n');

export function userPrompt({ facelets, maxMoves, stickersHome }) {
  return [
    'Current cube state:',
    '',
    netDiagram(facelets),
    '',
    `Facelet string (URFDLB order): ${facelets}`,
    `Stickers already on their home face: ${stickersHome}/54`,
    '',
    `Solve it. Give the complete move sequence, up to ${maxMoves} moves, that takes this`,
    'state to a solved cube — every stage, in order, in one list.',
    'JSON only, no commentary outside the JSON.',
  ].join('\n');
}

/** Pull the move list out of whatever the model returned. */
export function parseReply(text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    const match = text && text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        payload = JSON.parse(match[0]);
      } catch {
        payload = null;
      }
    }
  }

  let tokens = [];
  if (payload && Array.isArray(payload.moves)) tokens = payload.moves;
  else if (payload && typeof payload.moves === 'string') tokens = payload.moves.split(/\s+/);
  else if (text) tokens = String(text).split(/\s+/);

  const moves = [];
  const rejected = [];
  for (const token of tokens.slice(0, 140)) {
    const move = parseMove(token);
    if (move) moves.push({ ...move, token: String(token).trim() });
    else if (String(token).trim()) rejected.push(String(token).trim().slice(0, 12));
  }

  return {
    moves,
    rejected,
    stage: payload && typeof payload.stage === 'string' ? payload.stage.slice(0, 80) : '',
    plan: payload && typeof payload.plan === 'string' ? payload.plan.slice(0, 300) : '',
  };
}
