// Jev (TypeSafe "System One") answers typed questions rather than writing text,
// so the cube is solved as a policy: one `choice` question per move, 18 options,
// picked against the current sticker state. Pure functions only — no API key.
import { FACE_NAME, FACE_ORDER, parseMove } from './cube';
import { netDiagram } from './kimi';

export const DEFAULT_MODEL = 'jev-latest';

// $42 per billion input tokens; output tokens are not charged.
export const RATES = { in: 0.042, out: 0 };

export function costOf(usage, rates = RATES) {
  return ((usage.input_tokens || 0) * rates.in + (usage.output_tokens || 0) * rates.out) / 1e6;
}

const SUFFIX = { 1: '', [-1]: "'", 2: '2' };
const TURN_WORD = { 1: 'a quarter turn clockwise', [-1]: 'a quarter turn anti-clockwise', 2: 'a half turn' };

/**
 * The legal face turns, as an option map Jev chooses between. The face just
 * turned is left out: turning it again only undoes or doubles the last move,
 * and with a flat-ish distribution the policy otherwise loops on one face.
 */
export function moveOptions(excludeFace) {
  const options = {};
  for (const face of FACE_ORDER) {
    if (face === excludeFace) continue;
    for (const amount of [1, -1, 2]) {
      options[face + SUFFIX[amount]] =
        `Turn the ${FACE_NAME[face]} face ${TURN_WORD[amount]}`;
    }
  }
  return options;
}

export function buildState(facelets, stickersHome, lastMove) {
  return [
    'A 3x3x3 Rubik\'s Cube, unfolded. Up on top, then Left Front Right Back in a',
    'band, then Down. Each letter is the face a sticker belongs to when solved.',
    '',
    netDiagram(facelets),
    '',
    `Facelet string (URFDLB order): ${facelets}`,
    `Stickers already on their home face: ${stickersHome} of 54.`,
    'Centres never move. A face is solved when all nine stickers match its centre.',
    lastMove ? `The previous move played was ${lastMove}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export const INSTRUCTIONS = [
  'Which single face turn best advances this cube toward solved?',
  'Judge the position as it stands: prefer the turn that sets up or completes a',
  'cross edge, a first-two-layers pair, or a last-layer case, and avoid a turn',
  'that immediately undoes the previous one.',
].join(' ');

/** Turn Jev's chosen label back into a move the engine understands. */
export function readAnswer(answer) {
  if (!answer || typeof answer.choice !== 'string') return null;
  const move = parseMove(answer.choice);
  if (!move) return null;
  const probabilities = answer.probabilities || {};
  return {
    ...move,
    token: answer.choice,
    confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
    probability: typeof probabilities[answer.choice] === 'number' ? probabilities[answer.choice] : null,
  };
}
