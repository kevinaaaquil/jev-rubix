// One typed question per step: "read the cube for me". Jev is asked where a
// piece sits or which case the last layer is in — perception, which is what a
// System One model is for. The code already knows the answer, so every reply
// is verified, and the algorithm played comes from the solver either way.
import { CORNERS, EDGES, FACES, PIECES, fromFacelets, pieceSolved } from './facelets';

const COLOR_NAME = { U: 'white', D: 'yellow', F: 'green', R: 'red', L: 'orange', B: 'blue' };
const PLACE = { U: 'top', D: 'bottom', F: 'front', B: 'back', L: 'left', R: 'right' };
const ORDER = { U: 0, D: 0, F: 1, B: 1, L: 2, R: 2 };

const U_FACE = FACES.indexOf('U');
const U_EDGES = EDGES.filter((p) => p.layer === 'U');
const U_CORNERS = CORNERS.filter((p) => p.layer === 'U');

const slotName = (faces) =>
  [...faces].sort((a, b) => ORDER[a] - ORDER[b]).map((f) => PLACE[f]).join('-');

export const pieceName = (piece) =>
  `${piece.faces.map((f) => COLOR_NAME[f]).join('-')} ${piece.type}`;

/**
 * Every slot on the cube and the colour on each of its faces — the position
 * written out the way you would hand it to someone, instead of as ASCII art.
 */
export function slotReadout(facelets) {
  const state = fromFacelets(facelets);
  const out = {};
  for (const slot of PIECES) {
    const here = {};
    slot.faces.forEach((face, i) => {
      here[PLACE[face]] = COLOR_NAME[FACES[state[slot.indices[i]]]];
    });
    out[slotName(slot.faces)] = here;
  }
  return out;
}

/** Which slot a piece currently occupies, and where its key colour points. */
export function locate(state, piece) {
  const keyColor = piece.colors[0];
  const wanted = [...piece.colors].sort().join(',');
  for (const slot of PIECES) {
    if (slot.type !== piece.type) continue;
    const here = slot.indices.map((i) => state[i]);
    if ([...here].sort().join(',') !== wanted) continue;
    const at = here.indexOf(keyColor);
    return { slot, keyFace: slot.faces[at] };
  }
  return null;
}

/** Every place that piece could be, phrased the way a person would say it. */
function placementOptions(piece) {
  const options = {};
  const keyName = COLOR_NAME[piece.faces[0]];
  for (const slot of PIECES) {
    if (slot.type !== piece.type) continue;
    for (const face of slot.faces) {
      // Keys are readable so a text model can copy one back without slipping.
      options[`${slotName(slot.faces)}|${PLACE[face]}`] =
        `at ${slotName(slot.faces)}, ${keyName} facing ${PLACE[face]}`;
    }
  }
  return options;
}

const placementKey = (found) => `${slotName(found.slot.faces)}|${PLACE[found.keyFace]}`;

/** The piece a piece-by-piece stage is working on next. */
export function targetPiece(state, pieces) {
  return pieces.find((p) => !pieceSolved(state, p)) || null;
}

function topCrossCase(state) {
  const up = U_EDGES.filter((p) => state[p.indices[0]] === U_FACE);
  if (up.length === 4) return 'cross';
  if (up.length === 0) return 'dot';
  const faces = up.map((p) => p.faces[1]);
  const opposite = { F: 'B', B: 'F', L: 'R', R: 'L' };
  return faces.length === 2 && opposite[faces[0]] === faces[1] ? 'line' : 'L-shape';
}

function countUp(state, pieces) {
  return pieces.filter((p) => p.indices.some((i, n) => n === 0 && state[i] === U_FACE)).length;
}

const COUNT_WORDS = ['none of them', 'one of them', 'two of them', 'three of them', 'all four'];

/**
 * Build the question for the current stage. `truth` never leaves the browser —
 * it is what the answer is checked against.
 */
export function buildQuestion(state, stage) {
  if (stage.target) {
    const piece = stage.target(state);
    if (!piece) return null;
    const found = locate(state, piece);
    if (!found) return null;
    return {
      subject: pieceName(piece),
      prompt: `Where is the ${pieceName(piece)} sitting right now, and which way is it facing?`,
      options: placementOptions(piece),
      truth: placementKey(found),
    };
  }

  if (stage.key === 'topCross') {
    return {
      subject: 'top edges',
      prompt: 'What shape do the top-face stickers make on the top layer?',
      options: {
        dot: 'a dot — no top edge is facing up',
        'L-shape': 'an L — two neighbouring edges face up',
        line: 'a line — two opposite edges face up',
        cross: 'a full cross — all four edges face up',
      },
      truth: topCrossCase(state),
    };
  }

  if (stage.key === 'topCorners') {
    const n = countUp(state, U_CORNERS);
    return {
      subject: 'top corners',
      prompt: 'How many top corners already have their top colour facing up?',
      options: Object.fromEntries(COUNT_WORDS.map((w, i) => [String(i), `${w} face up`])),
      truth: String(n),
    };
  }

  if (stage.key === 'placeCorners') {
    const n = U_CORNERS.filter((p) => pieceSolved(state, p)).length;
    return {
      subject: 'top corners',
      prompt: 'How many top corners are already in their own slot?',
      options: Object.fromEntries(COUNT_WORDS.map((w, i) => [String(i), `${w} are home`])),
      truth: String(n),
    };
  }

  if (stage.key === 'placeEdges') {
    const n = U_EDGES.filter((p) => pieceSolved(state, p)).length;
    return {
      subject: 'top edges',
      prompt: 'How many top edges are already in their own slot?',
      options: Object.fromEntries(COUNT_WORDS.map((w, i) => [String(i), `${w} are home`])),
      truth: String(n),
    };
  }

  return null;
}
