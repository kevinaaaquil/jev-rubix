// Server-only. MOONSHOT_API_KEY is read here and never reaches the browser.
// Kimi answers exactly the question Jev is asked — read the cube — so the two
// readings can be compared on accuracy, latency and price.
import { readAsk } from '../../../lib/ask';
import { DEFAULT_MODEL, costOf, ratesFor } from '../../../lib/kimi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 90;

const hits = new Map();

/** Returns 0 when the caller is under the limit, else ms until the window resets. */
function rateLimited(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return 0;
  }
  entry.count += 1;
  return entry.count > MAX_CALLS_PER_WINDOW ? WINDOW_MS - (now - entry.start) : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const SYSTEM = [
  "You read Rubik's Cube positions. You are shown every slot on the cube with the",
  'colour showing on each of its faces, and asked one question about what you see,',
  'with a fixed list of possible answers.',
  '',
  'A piece is named by its colours, in any order. It sits in whichever slot shows',
  'exactly those colours, and a colour faces the direction it shows on.',
  '',
  'Answer with JSON only: {"choice": "<one option key, copied exactly>", "confidence": 0.0-1.0}',
].join('\n');

export async function POST(request) {
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) {
    return json(
      { error: 'MOONSHOT_API_KEY is not set on the server. Add it to .env, then restart.' },
      503
    );
  }

  const cooloff = rateLimited(request);
  if (cooloff) {
    return json(
      { error: 'Too many solve calls in the last minute.', rateLimited: true, retryAfterMs: cooloff },
      429
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const ask = readAsk(body);
  if (!ask) return json({ error: 'Malformed question.' }, 400);

  const model = process.env.KIMI_MODEL || DEFAULT_MODEL;
  const rates = ratesFor(model, process.env);
  // k2.6 reasons by default and will spend every token on it; this is a
  // perception question, so thinking stays off unless asked for.
  const thinking = process.env.KIMI_THINKING === 'enabled' ? 'enabled' : 'disabled';

  const user = [
    `Stage of the solve: ${ask.stage.name}. Looking at: ${ask.subject}.`,
    '',
    'The cube right now — every slot, and the colour showing on each of its faces:',
    JSON.stringify(ask.slots, null, 1),
    '',
    ask.prompt,
    '',
    'Options:',
    ...ask.options.map((o) => `  ${o.key} = ${o.text}`),
    '',
    'Reply with JSON only.',
  ].join('\n');

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: request.signal,
      body: JSON.stringify({
        model,
        thinking: { type: thinking },
        max_tokens: thinking === 'enabled' ? 8000 : 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === 'AbortError') return json({ error: 'aborted' }, 499);
    return json({ error: 'Could not reach the Kimi API.' }, 502);
  }

  const ms = Date.now() - started;

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      detail = '';
    }

    if (upstream.status === 402 || /quota|balance|insufficient|credit|arrears|billing/i.test(detail)) {
      return json({ error: 'sorry my fun wallet is empty now :)', walletEmpty: true, ms }, 402);
    }
    if (upstream.status === 429) {
      // Moonshot's Retry-After is often 1s, too short to clear a per-minute limit.
      const header = Number(upstream.headers.get('retry-after'));
      const suggested = Number.isFinite(header) && header > 0 ? header * 1000 : 15_000;
      return json(
        { error: 'Kimi is rate-limiting this key.', rateLimited: true, retryAfterMs: Math.min(Math.max(suggested, 5_000), 60_000), ms },
        429
      );
    }
    if (upstream.status === 401) return json({ error: 'Kimi rejected the API key.', ms }, 502);
    if (upstream.status === 404) {
      return json({ error: `The model "${model}" is not available to this key.`, ms }, 502);
    }
    return json({ error: `Kimi API returned ${upstream.status}.`, detail, ms }, 502);
  }

  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  let parsed = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = {};
      }
    }
  }

  const chosen = typeof parsed.choice === 'string' ? parsed.choice.trim() : '';
  const valid = ask.options.some((o) => o.key === chosen);

  const rawUsage = data?.usage || {};
  const usage = {
    prompt_tokens: rawUsage.prompt_tokens || 0,
    completion_tokens: rawUsage.completion_tokens || 0,
    cached_tokens: rawUsage.prompt_tokens_details?.cached_tokens || rawUsage.cached_tokens || 0,
  };

  return json({
    key: valid ? chosen : null,
    probability: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    usage,
    cost: costOf(usage, rates),
    ms,
    model,
    rates,
    finish: data?.choices?.[0]?.finish_reason || '',
  });
}
