// Server-only. TYPESAFE_API_KEY is read here and never reaches the browser.
// Jev answers one `choice` question per solve step: read the cube. The page
// holds the right answer and the algorithm, so this is perception, not search.
import { readAsk, optionMap } from '../../../lib/ask';
import { DEFAULT_MODEL, RATES, costOf } from '../../../lib/jev';

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
    return json({ error: 'TYPESAFE_API_KEY is not set on the server. Add it to .env, then restart.' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const ask = readAsk(body);
  if (!ask) return json({ error: 'Malformed question.' }, 400);
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
        state: {
          task: "Reading a Rubik's Cube mid-solve, using the beginner's method.",
          stage: ask.stage.name,
          looking_at: ask.subject,
          cube_now: ask.slots,
          how_to_read_it:
            'Every slot on the cube is listed with the colour showing on each of its faces. A piece is named by its colours; it is facing a direction when that colour shows on that face.',
        },
        questions: {
          reading: { type: 'choice', instructions: ask.prompt, criteria: optionMap(ask.options) },
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
    return json({ error: `TypeSafe returned ${upstream.status}.`, detail, ms }, 502);
  }

  const data = await upstream.json();
  const answer = data?.answers?.reading;
  const usage = {
    input_tokens: data?.usage?.input_tokens || 0,
    output_tokens: data?.usage?.output_tokens || 0,
  };

  return json({
    key: typeof answer?.choice === 'string' ? answer.choice : null,
    probability: answer?.probabilities?.[answer?.choice] ?? null,
    confidence: typeof answer?.confidence === 'number' ? answer.confidence : null,
    usage,
    cost: costOf(usage),
    ms,
    model: data?.model || model,
    rates: RATES,
  });
}
