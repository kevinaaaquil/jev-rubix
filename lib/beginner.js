// The beginner's method, in code. Each stage knows when it is done and what
// candidate sequences would advance it; the caller picks one (Jev, or the
// shortest). Search runs on the 54-byte facelet representation.
import {
  CORNERS,
  EDGES,
  MOVES,
  SOLVED,
  applySeq,
  apply,
  isSolvedState,
  pieceSolved,
} from './facelets';

const D_EDGES = EDGES.filter((p) => p.layer === 'D');
const D_CORNERS = CORNERS.filter((p) => p.layer === 'D');
const E_EDGES = EDGES.filter((p) => p.layer === 'E');
const U_EDGES = EDGES.filter((p) => p.layer === 'U');
const U_CORNERS = CORNERS.filter((p) => p.layer === 'U');

const U_FACE = 0; // colour id of the U face in facelets.js
const U_STICKERS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

const seq = (text) => text.trim().split(/\s+/);

// Face turns only — no slice or rotation moves exist in this app.
const ALGS = {
  edgeCross: seq("F R U R' U' F'"),
  sune: seq("R U R' U R U2 R'"),
  antiSune: seq("R U2 R' U' R U' R'"),
  tPerm: seq("R U R' U' R' F R2 U' R' U' R U R' F'"),
  yPerm: seq("F R U' R' U' R U R' F' R U R' U' R' F R F'"),
  aPerm: seq("R' F R' B2 R F' R' B2 R2"),
  uaPerm: seq("R U' R U R U R U' R' U' R2"),
  ubPerm: seq("R2 U R U R' U' R' U' R' U R'"),
  // Slots named by their two side faces, going round: FR, RB, BL, LF.
  // First-layer corners: the sexy pair at each slot, both hands.
  cornerFR: seq("R U R' U'"),
  cornerRB: seq("B U B' U'"),
  cornerBL: seq("L U L' U'"),
  cornerLF: seq("F U F' U'"),
  cornerFRb: seq("F' U' F U"),
  cornerRBb: seq("R' U' R U"),
  cornerBLb: seq("B' U' B U"),
  cornerLFb: seq("L' U' L U"),
  // Middle edges: right-hand insert U B U' B' U' A' U A at slot (A, B),
  // and the left-hand mirror U' A' U A U B U' B'.
  middleFR: seq("U R U' R' U' F' U F"),
  middleRB: seq("U B U' B' U' R' U R"),
  middleBL: seq("U L U' L' U' B' U B"),
  middleLF: seq("U F U' F' U' L' U L"),
  middleFRb: seq("U' F' U F U R U' R'"),
  middleRBb: seq("U' R' U R U B U' B'"),
  middleBLb: seq("U' B' U B U L U' L'"),
  middleLFb: seq("U' L' U L U F U' F'"),
};

const SETUPS = [[], ['U'], ['U2'], ["U'"]];

const allSolved = (state, pieces) => pieces.every((p) => pieceSolved(state, p));
/** The next piece a piece-by-piece stage works on, so the question and the
 *  algorithm are about the same thing. */
const firstUnsolved = (state, pieces) => pieces.find((p) => !pieceSolved(state, p)) || null;
const countOf = (state, pieces) => pieces.filter((p) => pieceSolved(state, p)).length;
const orientedUp = (state) => U_STICKERS.filter((i) => state[i] === U_FACE).length;
const edgesUp = (state) => U_EDGES.filter((p) => state[p.indices[0]] === U_FACE).length;

/** Shortest sequences (up to `limit`) satisfying `test`, searched breadth-first. */
function search(state, { maxDepth, test, limit = 6 }) {
  const found = [];
  const walk = (current, depth, path, lastFace) => {
    if (found.length >= limit) return;
    if (depth === 0) return;
    for (const move of MOVES) {
      const face = move[0];
      if (face === lastFace) continue; // two turns of one face are one turn
      const next = apply(current, move);
      const nextPath = [...path, move];
      if (test(next)) {
        found.push(nextPath);
        if (found.length >= limit) return;
        continue;
      }
      walk(next, depth - 1, nextPath, face);
    }
  };
  for (let depth = 1; depth <= maxDepth && found.length === 0; depth++) {
    walk(state, depth, [], '');
  }
  return found;
}

/** Sequences built from a bank of algorithms with U setups, breadth-first. */
function bankSearch(state, { bank, maxDepth, test, limit = 6 }) {
  const found = [];
  const seen = new Set();
  let frontier = [{ state, path: [] }];
  for (let depth = 0; depth < maxDepth && found.length < limit; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const [name, alg] of bank) {
        for (const setup of SETUPS) {
          const moves = [...setup, ...alg];
          const after = applySeq(node.state, moves);
          const path = [...node.path, { name, moves }];
          if (test(after)) {
            found.push(path);
            if (found.length >= limit) break;
            continue;
          }
          const key = after.join(',');
          if (seen.has(key)) continue;
          seen.add(key);
          next.push({ state: after, path });
        }
        if (found.length >= limit) break;
      }
      if (found.length >= limit) break;
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return found.map((path) => ({
    moves: path.flatMap((step) => step.moves),
    via: path.map((step) => step.name).join(' + '),
  }));
}

const STAGES = [
  {
    key: 'cross',
    name: 'Bottom cross',
    describe: 'Put the four bottom edges in place, the right way up.',
    done: (s) => allSolved(s, D_EDGES),
    progress: (s) => `${countOf(s, D_EDGES)}/4 edges`,
    target: (s) => firstUnsolved(s, D_EDGES),
    candidates(state) {
      const target = firstUnsolved(state, D_EDGES);
      const keep = D_EDGES.filter((p) => pieceSolved(state, p));
      return search(state, {
        maxDepth: 7,
        limit: 6,
        test: (s) => pieceSolved(s, target) && keep.every((p) => pieceSolved(s, p)),
      }).map((moves) => ({ moves, via: 'free turns' }));
    },
  },
  {
    key: 'corners',
    name: 'Bottom corners',
    describe: 'Drop each bottom corner into its slot with repeated R U R′ U′.',
    done: (s) => allSolved(s, D_CORNERS),
    progress: (s) => `${countOf(s, D_CORNERS)}/4 corners`,
    target: (s) => firstUnsolved(s, D_CORNERS),
    candidates(state) {
      const target = firstUnsolved(state, D_CORNERS);
      const keep = D_CORNERS.filter((p) => pieceSolved(state, p));
      const bank = [
        ['front-right slot', ALGS.cornerFR],
        ['right-back slot', ALGS.cornerRB],
        ['back-left slot', ALGS.cornerBL],
        ['left-front slot', ALGS.cornerLF],
        ['front-right slot, other hand', ALGS.cornerFRb],
        ['right-back slot, other hand', ALGS.cornerRBb],
        ['back-left slot, other hand', ALGS.cornerBLb],
        ['left-front slot, other hand', ALGS.cornerLFb],
      ];
      return bankSearch(state, {
        bank,
        maxDepth: 6,
        limit: 6,
        test: (s) =>
          pieceSolved(s, target) && keep.every((p) => pieceSolved(s, p)) && allSolved(s, D_EDGES),
      });
    },
  },
  {
    key: 'middle',
    name: 'Middle layer',
    describe: 'Send each middle edge from the top into its slot.',
    done: (s) => allSolved(s, E_EDGES),
    progress: (s) => `${countOf(s, E_EDGES)}/4 edges`,
    target: (s) => firstUnsolved(s, E_EDGES),
    candidates(state) {
      const target = firstUnsolved(state, E_EDGES);
      const keep = E_EDGES.filter((p) => pieceSolved(state, p));
      const bank = [
        ['front-right slot', ALGS.middleFR],
        ['right-back slot', ALGS.middleRB],
        ['back-left slot', ALGS.middleBL],
        ['left-front slot', ALGS.middleLF],
        ['front-right slot, other hand', ALGS.middleFRb],
        ['right-back slot, other hand', ALGS.middleRBb],
        ['back-left slot, other hand', ALGS.middleBLb],
        ['left-front slot, other hand', ALGS.middleLFb],
      ];
      return bankSearch(state, {
        bank,
        maxDepth: 4,
        limit: 6,
        test: (s) =>
          pieceSolved(s, target) &&
          keep.every((p) => pieceSolved(s, p)) &&
          allSolved(s, D_EDGES) &&
          allSolved(s, D_CORNERS),
      });
    },
  },
  {
    key: 'topCross',
    name: 'Top cross',
    describe: 'Flip the top edges face-up with F R U R′ U′ F′.',
    done: (s) => edgesUp(s) === 4,
    progress: (s) => `${edgesUp(s)}/4 edges up`,
    candidates(state) {
      const bank = [['F R U R′ U′ F′', ALGS.edgeCross]];
      return bankSearch(state, {
        bank,
        maxDepth: 3,
        limit: 4,
        test: (s) =>
          edgesUp(s) === 4 &&
          allSolved(s, D_EDGES) &&
          allSolved(s, D_CORNERS) &&
          allSolved(s, E_EDGES),
      });
    },
  },
  {
    key: 'topCorners',
    name: 'Top corners face up',
    describe: 'Turn the top corners the right way up with sune.',
    done: (s) => orientedUp(s) === 9,
    progress: (s) => `${orientedUp(s)}/9 top stickers`,
    candidates(state) {
      const bank = [
        ['sune', ALGS.sune],
        ['anti-sune', ALGS.antiSune],
      ];
      return bankSearch(state, {
        bank,
        maxDepth: 4,
        limit: 6,
        test: (s) =>
          orientedUp(s) === 9 &&
          allSolved(s, D_EDGES) &&
          allSolved(s, D_CORNERS) &&
          allSolved(s, E_EDGES),
      });
    },
  },
  {
    key: 'placeCorners',
    name: 'Top corners home',
    describe: 'Swap the top corners into their own slots.',
    done: (s) => allSolved(s, U_CORNERS),
    progress: (s) => `${countOf(s, U_CORNERS)}/4 corners`,
    candidates(state) {
      const bank = [
        ['T-perm', ALGS.tPerm],
        ['Y-perm', ALGS.yPerm],
        ['A-perm', ALGS.aPerm],
      ];
      return bankSearch(state, {
        bank,
        maxDepth: 3,
        limit: 6,
        test: (s) =>
          allSolved(s, U_CORNERS) &&
          allSolved(s, D_EDGES) &&
          allSolved(s, D_CORNERS) &&
          allSolved(s, E_EDGES),
      });
    },
  },
  {
    key: 'placeEdges',
    name: 'Top edges home',
    describe: 'Cycle the last edges into place.',
    done: (s) => isSolvedState(s),
    progress: (s) => `${countOf(s, U_EDGES)}/4 edges`,
    candidates(state) {
      const bank = [
        ['Ua-perm', ALGS.uaPerm],
        ['Ub-perm', ALGS.ubPerm],
      ];
      return bankSearch(state, { bank, maxDepth: 4, limit: 6, test: isSolvedState });
    },
  },
];

export function stageOf(state) {
  return STAGES.find((stage) => !stage.done(state)) || null;
}

/** Candidate sequences for the current stage, shortest first. */
export function nextCandidates(state) {
  const stage = stageOf(state);
  if (!stage) return { stage: null, candidates: [] };
  const candidates = stage
    .candidates(state)
    .map((c) => ({ ...c, length: c.moves.length }))
    .sort((a, b) => a.length - b.length)
    .slice(0, 6);
  return { stage, candidates };
}

/**
 * Solve from `state`. `pick(candidates, stage, state)` chooses one — it may be
 * async, and returning nothing falls back to the shortest.
 */
export async function solve(state, pick, { maxSteps = 60, onStep } = {}) {
  let current = state;
  const moves = [];
  const steps = [];

  for (let i = 0; i < maxSteps && !isSolvedState(current); i++) {
    const { stage, candidates } = nextCandidates(current);
    if (!stage || !candidates.length) {
      return { solved: false, moves, steps, stuck: stage ? stage.key : 'unknown' };
    }
    const chosen = (pick ? await pick(candidates, stage, current) : null) || candidates[0];
    current = applySeq(current, chosen.moves);
    moves.push(...chosen.moves);
    const step = {
      stage: stage.key,
      stageName: stage.name,
      via: chosen.via,
      moves: chosen.moves,
      progress: stage.progress(current),
      chosenIndex: candidates.indexOf(chosen),
      options: candidates.length,
    };
    steps.push(step);
    if (onStep) await onStep(step, current);
  }

  return { solved: isSolvedState(current), moves, steps, state: current };
}

export { STAGES, SOLVED };
