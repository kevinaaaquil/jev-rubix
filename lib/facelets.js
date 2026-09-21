// A fast representation for search: the cube as 54 bytes, each move a
// permutation. Everything here is derived from lib/cube.js by simulation, so
// the two can never disagree about what a turn does.
import { FACE_ORDER, NORMAL, TURN, applyTurn, createCubies } from './cube';

export const FACES = ['U', 'R', 'F', 'D', 'L', 'B']; // facelet string order
export const FACE_ID = Object.fromEntries(FACES.map((f, i) => [f, i]));

/** Where a given cubie's sticker sits in the 54-length facelet string. */
function indexOf(face, pos) {
  const [x, y, z] = pos;
  const at = (row, col) => FACES.indexOf(face) * 9 + row * 3 + col;
  const to = (v) => v + 1; // -1,0,1 -> 0,1,2
  switch (face) {
    case 'U': return at(to(z), to(x));
    case 'D': return at(to(-z), to(x));
    case 'F': return at(to(-y), to(x));
    case 'B': return at(to(-y), to(-x));
    case 'L': return at(to(-y), to(z));
    case 'R': return at(to(-y), to(-z));
    default: return -1;
  }
}

/** Every sticker of the solved cube: its facelet index and the piece it is on. */
function stickerTable() {
  const stickers = [];
  for (const c of createCubies()) {
    for (const f of FACE_ORDER) {
      if (!c.colors[f]) continue;
      stickers.push({ index: indexOf(f, c.pos), face: f, home: c.home.join(',') });
    }
  }
  return stickers;
}

/** The colour each facelet shows on a solved cube. */
export const SOLVED = (() => {
  const state = new Uint8Array(54);
  for (const s of stickerTable()) state[s.index] = FACE_ID[s.face];
  return state;
})();

/**
 * For every move, the permutation P with next[i] = prev[P[i]] — worked out by
 * tagging each sticker with its index and seeing where the engine sends it.
 */
export const MOVE_PERM = (() => {
  const perms = {};
  for (const face of Object.keys(TURN)) {
    for (const [suffix, amount] of [['', 1], ["'", -1], ['2', 2]]) {
      const cubies = createCubies();
      // tag: remember each sticker's starting facelet index
      for (const c of cubies) {
        c.tags = {};
        for (const f of FACE_ORDER) if (c.colors[f]) c.tags[f] = indexOf(f, c.pos);
      }
      // the engine moves colours; carry the tags the same way
      const tagged = cubies.map((c) => ({ ...c, colors: { ...c.tags } }));
      applyTurn(tagged, face, amount);

      const perm = new Uint8Array(54);
      for (const c of tagged) {
        for (const f of FACE_ORDER) {
          const from = c.colors[f];
          if (from === null || from === undefined) continue;
          perm[indexOf(f, c.pos)] = from;
        }
      }
      perms[face + suffix] = perm;
    }
  }
  return perms;
})();

export const MOVES = Object.keys(MOVE_PERM);

export function apply(state, move) {
  const perm = MOVE_PERM[move];
  const next = new Uint8Array(54);
  for (let i = 0; i < 54; i++) next[i] = state[perm[i]];
  return next;
}

export function applySeq(state, moves) {
  let s = state;
  for (const m of moves) s = apply(s, m);
  return s;
}

/** The facelet string (URFDLB) as this project's engine writes it. */
export function fromFacelets(text) {
  const state = new Uint8Array(54);
  for (let i = 0; i < 54; i++) state[i] = FACE_ID[text[i]];
  return state;
}

export function toFacelets(state) {
  let out = '';
  for (let i = 0; i < 54; i++) out += FACES[state[i]];
  return out;
}

export const isSolvedState = (state) => {
  for (let i = 0; i < 54; i++) if (state[i] !== SOLVED[i]) return false;
  return true;
};

/* ---------- pieces ---------- */

/** Each piece as its facelet indices, in a fixed order, with its home colours. */
export const PIECES = (() => {
  const byPiece = new Map();
  for (const s of stickerTable()) {
    if (!byPiece.has(s.home)) byPiece.set(s.home, []);
    byPiece.get(s.home).push(s);
  }
  const pieces = [];
  for (const [home, stickers] of byPiece) {
    if (stickers.length < 2) continue; // centres never move
    pieces.push({
      home,
      type: stickers.length === 3 ? 'corner' : 'edge',
      indices: stickers.map((s) => s.index),
      colors: stickers.map((s) => FACE_ID[s.face]),
      faces: stickers.map((s) => s.face),
      layer: stickers.some((s) => s.face === 'U') ? 'U' : stickers.some((s) => s.face === 'D') ? 'D' : 'E',
    });
  }
  return pieces;
})();

export const pieceSolved = (state, piece) =>
  piece.indices.every((idx, i) => state[idx] === piece.colors[i]);

export const countSolved = (state, pieces) =>
  pieces.reduce((n, p) => n + (pieceSolved(state, p) ? 1 : 0), 0);

export const EDGES = PIECES.filter((p) => p.type === 'edge');
export const CORNERS = PIECES.filter((p) => p.type === 'corner');
