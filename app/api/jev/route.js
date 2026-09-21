// Server-only. TYPESAFE_API_KEY is read here and never reaches the browser.
// The client posts a cube state; this route asks Jev one typed question —
// which of the 18 face turns to play next — and returns the answer.
import { validFacelets } from '../../../lib/kimi';
import {
  DEFAULT_MODEL,
  INSTRUCTIONS,
  RATES,
  buildState,
  costOf,
  moveOptions,
  readAnswer,
} from '../../../lib/jev';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) {
    return json(
      { error: 'TYPESAFE_API_KEY is not set on the server. Add it to .env, then restart.' },
      503
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const facelets = validFacelets(body?.facelets);
  if (!facelets) return json({ error: 'facelets must be 54 characters, nine of each of U D L R F B.' }, 400);
  const stickersHome = Math.min(Math.max(Number(body?.stickersHome) || 0, 0), 54);
  const lastMove = typeof body?.lastMove === 'string' && /^[UDLRFB](2|')?$/.test(body.lastMove)
    ? body.lastMove
    : '';
  const lastFace = lastMove ? lastMove[0] : '';
  const model = process.env.JEV_MODEL || DEFAULT_MODEL;

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: request.signal,
      body: JSON.stringify({
        model,
        state: buildState(facelets, stickersHome, lastMove),
        questions: {
          next_move: {
            type: 'choice',
            instructions: INSTRUCTIONS,
            criteria: moveOptions(lastFace),
          },
        },
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') return json({ error: 'aborted' }, 499);
    return json({ error: 'Could not reach the TypeSafe API.' }, 502);
  }

  const ms = Date.now() - started;

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      detail = '';
    }

    if (upstream.status === 429) {
      const header = Number(upstream.headers.get('retry-after'));
      const suggested = Number.isFinite(header) && header > 0 ? header * 1000 : 5_000;
      return json(
        { error: 'Jev is rate-limiting this key.', rateLimited: true, retryAfterMs: Math.min(Math.max(suggested, 2_000), 60_000), ms },
        429
      );
    }
    if (upstream.status === 401) return json({ error: 'TypeSafe rejected the API key.', ms }, 502);
    if (upstream.status === 402 || /quota|balance|insufficient|credit|billing/i.test(detail)) {
      return json({ error: 'sorry my fun wallet is empty now :)', walletEmpty: true, ms }, 402);
    }
    // Upstream text only — the key is never echoed back.
    return json({ error: `TypeSafe returned ${upstream.status}.`, detail, ms }, 502);
  }

  const data = await upstream.json();
  const move = readAnswer(data?.answers?.next_move);
  const usage = {
    input_tokens: data?.usage?.input_tokens || 0,
    output_tokens: data?.usage?.output_tokens || 0,
  };

  return json({
    move,
    usage,
    cost: costOf(usage),
    ms,
    model: data?.model || model,
    rates: RATES,
  });
}
