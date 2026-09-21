// Shared shape for "read the cube" questions: whatever the browser sends is
// sanitised here before it can reach a model, and both providers answer the
// same question so their readings can be compared directly.
import { netDiagram, validFacelets } from './kimi';
import { slotReadout } from './questions';

const KEY_RE = /^[\w,|'-]{1,48}$/;
const STAGES = new Set([
  'cross',
  'corners',
  'middle',
  'topCross',
  'topCorners',
  'placeCorners',
  'placeEdges',
]);

const clean = (text, max = 120) => String(text ?? '').replace(/[^\w ,.:;'’()\/-]/g, '').slice(0, max);

/** Returns a validated question, or null if the body is not one. */
export function readAsk(body) {
  const facelets = validFacelets(body?.facelets);
  if (!facelets) return null;
  if (!STAGES.has(body?.stage?.key)) return null;
  if (!Array.isArray(body?.options) || body.options.length < 2 || body.options.length > 64) return null;

  const options = [];
  for (const option of body.options) {
    const key = String(option?.key ?? '');
    if (!KEY_RE.test(key)) return null;
    options.push({ key, text: clean(option?.text, 80) });
  }

  return {
    facelets,
    net: netDiagram(facelets),
    slots: slotReadout(facelets),
    stage: { key: body.stage.key, name: clean(body.stage.name, 40) },
    subject: clean(body.subject, 40),
    prompt: clean(body.prompt, 200),
    options,
  };
}

export const optionMap = (options) => Object.fromEntries(options.map((o) => [o.key, o.text]));
