// Pure cube model: no DOM, no React. A cubie knows where it sits and which
// colour faces each world direction; a turn rewrites both.

export const FACE_ORDER = ['U', 'D', 'L', 'R', 'F', 'B'];

export const FACE_NAME = { U: 'Up', D: 'Down', L: 'Left', R: 'Right', F: 'Front', B: 'Back' };

export const NORMAL = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

export const COLOR = {
  U: '#f7f7f4',
  D: '#ffd500',
  L: '#ff5800',
  R: '#c41e3a',
  F: '#009e60',
  B: '#0051ba',
};

// For each face: the slice it grabs (axis + coordinate), how a clockwise turn
// maps a vector, and the matching CSS rotation. CSS points +Y down, which is
// why the degrees flip sign against the model.
export const TURN = {
  U: { axis: 1, val: 1, map: (p) => [-p[2], p[1], p[0]], css: 'rotateY', deg: -90 },
  D: { axis: 1, val: -1, map: (p) => [p[2], p[1], -p[0]], css: 'rotateY', deg: 90 },
  R: { axis: 0, val: 1, map: (p) => [p[0], p[2], -p[1]], css: 'rotateX', deg: 90 },
  L: { axis: 0, val: -1, map: (p) => [p[0], -p[2], p[1]], css: 'rotateX', deg: -90 },
  F: { axis: 2, val: 1, map: (p) => [p[1], -p[0], p[2]], css: 'rotateZ', deg: 90 },
  B: { axis: 2, val: -1, map: (p) => [-p[1], p[0], p[2]], css: 'rotateZ', deg: -90 },
};

export const AMOUNTS = [1, -1, 2];

export function dirOf(v) {
  return FACE_ORDER.find((f) => {
    const n = NORMAL[f];
    return n[0] === v[0] && n[1] === v[1] && n[2] === v[2];
  });
}

function stickersFor(pos) {
  const colors = {};
  for (const f of FACE_ORDER) {
    const n = NORMAL[f];
    const outward =
      (n[0] !== 0 && pos[0] === n[0]) ||
      (n[1] !== 0 && pos[1] === n[1]) ||
      (n[2] !== 0 && pos[2] === n[2]);
    colors[f] = outward ? f : null;
  }
  return colors;
}

export function createCubies() {
  const cubies = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        const pos = [x, y, z];
        cubies.push({ home: [x, y, z], pos, colors: stickersFor(pos) });
      }
    }
  }
  return cubies;
}

export function layerOf(cubies, face) {
  const t = TURN[face];
  return cubies.filter((c) => c.pos[t.axis] === t.val);
}

function turnOnce(cubies, face) {
  const t = TURN[face];
  for (const c of layerOf(cubies, face)) {
    c.pos = t.map(c.pos);
    const next = { U: null, D: null, L: null, R: null, F: null, B: null };
    for (const f of FACE_ORDER) next[dirOf(t.map(NORMAL[f]))] = c.colors[f];
    c.colors = next;
  }
}

/** amount: 1 = clockwise, -1 = counter-clockwise, 2 = half turn. */
export function applyTurn(cubies, face, amount) {
  const times = amount === 2 ? 2 : amount === 1 ? 1 : 3;
  for (let i = 0; i < times; i++) turnOnce(cubies, face);
}

export function restore(cubies) {
  for (const c of cubies) {
    c.pos = [...c.home];
    c.colors = stickersFor(c.pos);
  }
}

export function isSolved(cubies) {
  return FACE_ORDER.every((f) => {
    const n = NORMAL[f];
    let seen = null;
    for (const c of cubies) {
      const onFace =
        (n[0] !== 0 && c.pos[0] === n[0]) ||
        (n[1] !== 0 && c.pos[1] === n[1]) ||
        (n[2] !== 0 && c.pos[2] === n[2]);
      if (!onFace) continue;
      if (seen === null) seen = c.colors[f];
      else if (c.colors[f] !== seen) return false;
    }
    return true;
  });
}

export function invert(move) {
  return { face: move.face, amount: move.amount === 2 ? 2 : -move.amount };
}

export function notation(move) {
  return move.face + (move.amount === -1 ? '′' : move.amount === 2 ? '2' : '');
}

export function randomScramble(length = 25) {
  const moves = [];
  let last = '';
  for (let i = 0; i < length; i++) {
    let face;
    do {
      face = FACE_ORDER[Math.floor(Math.random() * FACE_ORDER.length)];
    } while (face === last);
    last = face;
    moves.push({ face, amount: AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)] });
  }
  return moves;
}

/* ---------- reading the cube out ---------- */

const at = (cubies, pos) =>
  cubies.find((c) => c.pos[0] === pos[0] && c.pos[1] === pos[1] && c.pos[2] === pos[2]);

/** A face as 3 rows of 3 colour letters, oriented the way you would look at it. */
export function readFace(cubies, face) {
  const grid = [];
  const cell = (pos) => at(cubies, pos).colors[face];
  const row = (fn) => {
    const r = [];
    for (let i = -1; i <= 1; i++) r.push(fn(i));
    return r;
  };
  if (face === 'U') for (let z = -1; z <= 1; z++) grid.push(row((x) => cell([x, 1, z])));
  if (face === 'D') for (let z = 1; z >= -1; z--) grid.push(row((x) => cell([x, -1, z])));
  if (face === 'F') for (let y = 1; y >= -1; y--) grid.push(row((x) => cell([x, y, 1])));
  if (face === 'B') for (let y = 1; y >= -1; y--) grid.push(row((x) => cell([-x, y, -1])));
  if (face === 'L') for (let y = 1; y >= -1; y--) grid.push(row((z) => cell([-1, y, z])));
  if (face === 'R') for (let y = 1; y >= -1; y--) grid.push(row((z) => cell([1, y, -z])));
  return grid;
}

/** 54 characters in URFDLB order — the usual facelet string. */
export function facelets(cubies) {
  return ['U', 'R', 'F', 'D', 'L', 'B']
    .map((f) => readFace(cubies, f).flat().join(''))
    .join('');
}

/** How many stickers already sit on their home face, out of 54. */
export function stickersHome(cubies) {
  let n = 0;
  for (const c of cubies) for (const f of FACE_ORDER) if (c.colors[f] === f) n++;
  return n;
}

const MOVE_RE = /^([UDLRFB])(2|'|\u2032)?$/;

/** "R", "U'", "F2" -> {face, amount}; anything else -> null. */
export function parseMove(token) {
  const m = MOVE_RE.exec(String(token).trim());
  if (!m) return null;
  const suffix = m[2];
  return { face: m[1], amount: suffix === '2' ? 2 : suffix ? -1 : 1 };
}

/* ---------- solution from the log ---------- */

const QUARTERS = { 1: 1, 2: 2, [-1]: 3 };

function fromQuarters(q) {
  const n = ((q % 4) + 4) % 4;
  if (n === 0) return null;
  return n === 1 ? 1 : n === 2 ? 2 : -1;
}

/** Collapse neighbouring turns of the same face: R R -> R2, R R' -> nothing. */
export function collapse(moves) {
  const out = [];
  for (const move of moves) {
    const prev = out[out.length - 1];
    if (prev && prev.face === move.face) {
      out.pop();
      const merged = fromQuarters(QUARTERS[prev.amount] + QUARTERS[move.amount]);
      if (merged) out.push({ face: move.face, amount: merged });
      continue;
    }
    out.push({ ...move });
  }
  // A cancellation can make two new neighbours meet, so settle.
  return out.length === moves.length ? out : collapse(out);
}

/**
 * The moves that return the cube to solved, derived by rewinding the log:
 * every recorded turn, reversed and inverted, then collapsed.
 */
export function solutionFromHistory(history) {
  return collapse([...history].reverse().map(invert));
}
