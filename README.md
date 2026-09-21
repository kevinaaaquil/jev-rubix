# jev-rubix

Interactive 3D Rubik's Cube console. Next.js (App Router), no 3D library —
the cube is 26 CSS-transformed cubies.

```bash
npm install
npm run dev     # http://localhost:3000
```

## Layout

| Path | What it holds |
| --- | --- |
| `lib/cube.js` | Pure model: cubie positions, turn transforms, solved check, scrambles. No DOM. |
| `lib/cube-scene.js` | The imperative 3D layer: builds the cubie elements, animates a turn, handles drag-to-orbit. |
| `app/CubeConsole.jsx` | React chrome: button grid, move log, status, keyboard shortcuts. |
| `app/globals.css` | Tokens and both themes. |
| `app/api/solve/route.js` | Server-only Kimi call. Reads `MOONSHOT_API_KEY`; nothing about it reaches the browser. |
| `lib/kimi.js` | Prompt, reply parsing, pricing table. No key. |
| `app/useKimiSolver.js` | The solve loop: post state, apply moves, tally cost, abort. |
| `app/KimiPanel.jsx` | The floating abort card, shared by both solvers. |
| `app/api/jev/route.js` | Server-only TypeSafe call. Reads `TYPESAFE_API_KEY`. |
| `lib/jev.js` | Jev's state text, the 18-option choice question, pricing. |
| `app/useJevSolver.js` | Jev's policy loop: one typed decision per move. |

## Notation

`R` clockwise · `R′` counter-clockwise · `R2` half turn, for each of
**U** (up), **D** (down), **L** (left), **R** (right), **F** (front), **B** (back).

Keyboard: `U D L R F B` turn a face, `Shift` + letter for prime, `S` scramble,
`Backspace` undo, `Esc` reset.

## Model notes

A cubie stores its position and which colour faces each world direction. One
turn applies the same 90° vector map to both the position and every sticker
normal, so orientation never accumulates error — a face's DOM element is fixed
and only its colour is repainted. `U⁴`, `(R U R′ U′)⁶` and scramble-then-invert
all return to solved.

## Kimi solver

**Solve using Kimi**, the small button under the face-turn grid, asks for a
complete solve and revisits if that fails.

Each attempt posts **only the current 54-sticker state** — never the move log, so
the model cannot invert what was played — and asks for the whole sequence from
that state to solved, up to 80 moves. The app plays the sequence. If the cube is
not solved, the new state goes back as a fresh, standalone attempt, with no
memory of the last one. It stops when the cube is solved, when you hit **Abort**,
after 10 attempts, or at a $0.25 spend cap (`useKimiSolver` options).

The abort card only exists while a solve is in flight; it shows thinking time,
moves applied, spend, cost per move, last call latency and stickers home.

Measured with `kimi-k2.6`: an attempt returns 70–80 moves in ~7s for ~$0.0013,
and does not solve the cube — progress hovers around 11–19 of 54 stickers home.
The stats are the point: they show what the attempt cost and how little it moved.

## Solve using Jev

The second trigger runs [TypeSafe AI](https://typesafe.ai/)'s **Jev**, a "System
One" model that answers typed questions rather than writing text. It cannot emit
a move list, so the solve is a policy loop: each call sends the sticker state and
one `choice` question — which of the face turns to play next — and the app plays
whichever option comes back, then asks again. The face just turned is left out of
the options, since replaying it only undoes or doubles the last move.

`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, key
`TYPESAFE_API_KEY`, read server-side in `app/api/jev/route.js`. Input is $0.042
per 1M tokens and output is free, so a move costs about $0.000037 — measured at
~0.4s per call, 1,200 requests a minute allowed, so no pacing is needed.

Measured: 80 moves in 55s for $0.0029, and it does not solve the cube. Jev's
distribution over the 18 turns is nearly flat (the chosen move takes 12–23% of
it, against 5.6% for a coin toss), so it picks one face repeatedly; with the
repeat guard it alternates two. Progress sits around 11–16 of 54 stickers home.
That is the honest result for a decision model asked to do search.

## Stats

**Stats** sits in the controls row and is always clickable; with nothing recorded
its tooltip reads *solve atleast once for stats* and the panel explains how to
get one. The panel shows **total solve time** and **average move time**
(time ÷ moves) as the headline pair, plus solves, total moves, average solve,
best solve, Kimi spend when Kimi took part, and a row per solve. **Clear stats**
empties it.

Records live in React state for the open tab only — no localStorage, no database,
nothing written server-side. A refresh clears them.

A solve is recorded only for the round trip **Scramble button → solved**, by
whoever got there: your clicks, Kimi, or both. Turning a solved cube by hand into
a scrambled one and back records nothing, and **Reset** abandons the session
without a record. Moves are counted as physical turns performed, so an undo
counts as a turn like any other.

### API key

The key is read server-side in the route handler only — never bundled, never
returned in a response. `.env.example` lists every variable; copy it and fill in
the key:

```bash
cp .env.example .env.local
# then set MOONSHOT_API_KEY=sk-...
```

`.env` and `.env.*` are gitignored (`.env.example` is the one exception, so it
can be committed).

Restart `npm run dev` after adding it. On Vercel, set `MOONSHOT_API_KEY` as a
project environment variable (Production + Preview) — do not commit it.

Default model is `kimi-k2.6` at $0.95 / 1M input ($0.16 cached) and $4.00 / 1M
output — the cheapest model a Moonshot key typically reaches. Check yours with
`curl -H "Authorization: Bearer $MOONSHOT_API_KEY" https://api.moonshot.ai/v1/models`
and set `KIMI_MODEL` if it differs; override the rates with `KIMI_PRICE_IN`,
`KIMI_PRICE_CACHED`, `KIMI_PRICE_OUT`.

k2.6 is a reasoning model and, left alone, will spend an entire 8k token budget
thinking about the cube and never emit its JSON (measured: 150s, $0.03, no
moves). The route therefore sends `thinking: {type: "disabled"}`, which answers
in ~8s for ~$0.0006 a round. Set `KIMI_THINKING=enabled` for the slow, expensive
version. Temperature is left at the model default because k2.6 rejects any other.
If the account runs out of credit, the panel says *sorry my fun wallet is empty now :)*

### Rate limits

Moonshot allows roughly three calls a minute on a standard key. Two things keep
the loop under that: each call asks for a whole solve rather than a few moves,
and the loop leaves at least 20s between the start of one call and the next
(`minGapMs`), showing *Pacing calls* while it waits. Measured over a two-minute
run: 5–6 calls, all 200, no refusals.

When a 429 does arrive its `Retry-After` header says 1s, which is not enough to
clear the window, so a 429 is treated as a wait, not a failure: the panel shows *Rate limited —
waiting* and the loop backs off 5s, 10s, 20s, 40s, 60s (whichever is longer,
that or the server's hint), up to eight waits. A round that lands resets the
budget, so a long solve survives an indefinite number of limits. **Abort** still
lands instantly while waiting.

### Guards

- 54 validated facelet characters are the only client input that reaches the prompt; the net diagram is redrawn server-side, so the route cannot be used as a free proxy.
- 90 calls per IP per minute.
- Aborting the browser request aborts the upstream Kimi call with it.
