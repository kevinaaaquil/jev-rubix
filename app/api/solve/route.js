// Server-only. MOONSHOT_API_KEY is read here and never sent to the browser:
// the client posts a cube state, this route builds the prompt, calls Kimi and
// returns moves plus usage. Nothing from the request reaches the model except
// 54 validated facelet characters.
import {
  DEFAULT_MODEL,
  SYSTEM_PROMPT,
  costOf,
  parseReply,
  ratesFor,
  userPrompt,
  validFacelets,
} from '../../../lib/kimi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
// kimi-k2.6 is the cheapest model this key can reach ($0.95 / $4.00 per 1M).
// One-shot solving: a whole solve is 60-100 moves for a layer-by-layer method,
// and fewer, bigger calls also keep the per-minute limit at arm's length.
const MAX_MOVES = 120;
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

export async function POST(request) {
  const key = process.env.MOONSHOT_API_KEY;
  if (!key) {
    return json(
      { error: 'MOONSHOT_API_KEY is not set on the server. Add it to .env.local (local) or the Vercel project env, then restart.' },
      503
    );
  }

  const cooloff = rateLimited(request);
  if (cooloff) {
    // Same shape as an upstream limit, so the solver waits it out instead of failing.
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

  const facelets = validFacelets(body?.facelets);
  if (!facelets) return json({ error: 'facelets must be 54 characters, nine of each of U D L R F B.' }, 400);

  const maxMoves = Math.min(Math.max(Number(body?.maxMoves) || 80, 1), MAX_MOVES);
  const stickersHome = Math.min(Math.max(Number(body?.stickersHome) || 0, 0), 54);
  const model = process.env.KIMI_MODEL || DEFAULT_MODEL;
  // k2.6 reasons by default and will happily spend every token thinking about a
  // cube without ever emitting the JSON, so thinking is off unless asked for.
  const thinking = process.env.KIMI_THINKING === 'enabled' ? 'enabled' : 'disabled';
  const rates = ratesFor(model, process.env);

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      signal: request.signal, // aborting the browser request aborts Kimi too
      body: JSON.stringify({
        model,
        // k2.6 rejects any temperature but 1, so leave it at the model default.
        thinking: { type: thinking },
        max_tokens: thinking === 'enabled' ? 8000 : 2500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt({ facelets, maxMoves, stickersHome }) },
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

    // Out of credit reads as a quota/balance error, which is not a bug to debug.
    const broke =
      upstream.status === 402 ||
      /quota|balance|insufficient|credit|arrears|billing/i.test(detail);
    if (broke) {
      return json({ error: 'sorry my fun wallet is empty now :)', walletEmpty: true, ms }, 402);
    }

    // Moonshot limits requests per minute; that is a wait, not a failure.
    if (upstream.status === 429) {
      // Moonshot's Retry-After is often 1s, which is not long enough to clear a
      // per-minute limit, so never back off by less than five seconds.
      const header = Number(upstream.headers.get('retry-after'));
      const suggested = Number.isFinite(header) && header > 0 ? header * 1000 : 15_000;
      const retryAfterMs = Math.min(Math.max(suggested, 5_000), 60_000);
      return json(
        { error: 'Kimi is rate-limiting this key.', rateLimited: true, retryAfterMs, ms },
        429
      );
    }

    if (upstream.status === 401) {
      return json({ error: 'Kimi rejected the API key.', ms }, 502);
    }

    if (upstream.status === 404) {
      return json(
        { error: `The model "${model}" is not available to this key. Set KIMI_MODEL to one your account lists.`, ms },
        502
      );
    }

    // Upstream text only — the key is never echoed back.
    return json({ error: `Kimi API returned ${upstream.status}.`, detail, ms }, 502);
  }

  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  const parsed = parseReply(text);

  const rawUsage = data?.usage || {};
  const usage = {
    prompt_tokens: rawUsage.prompt_tokens || 0,
    completion_tokens: rawUsage.completion_tokens || 0,
    reasoning_tokens: rawUsage.completion_tokens_details?.reasoning_tokens || 0,
    cached_tokens:
      rawUsage.cached_tokens ||
      rawUsage.prompt_tokens_details?.cached_tokens ||
      rawUsage.prompt_cache_hit_tokens ||
      0,
  };

  return json({
    moves: parsed.moves.slice(0, maxMoves),
    rejected: parsed.rejected,
    stage: parsed.stage,
    plan: parsed.plan,
    usage,
    cost: costOf(usage, rates),
    ms,
    model,
    thinking,
    rates,
    finish: data?.choices?.[0]?.finish_reason || '',
  });
}
