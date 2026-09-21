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
| `app/SolveOverlay.jsx` | The abort card: the question, the reading, the algorithm. |
| `app/useSolver.js` | The shared step loop, used by both models. |
| `lib/beginner.js` | The beginner's method: stages, candidate sequences, search. |
| `lib/facelets.js` | 54-byte cube and move permutations, derived from the engine. |
| `lib/questions.js` | The per-stage question, its options, and the true answer. |
| `lib/ask.js` | Validates a question before it can reach a model. |
| `app/api/jev/route.js` | Server-only TypeSafe call. Reads `TYPESAFE_API_KEY`. |
| `lib/jev.js` | Jev's model id and pricing. |

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

The cube is solved by **code**: `lib/beginner.js` runs the beginner's method —
bottom cross, bottom corners, middle layer, top cross, top corners up, top
corners home, top edges home — and at each step produces the legal sequences
that finish that step. Verified over 500 random scrambles: 500 solved, every
solution replayed through the engine to confirm, ~135 moves and ~12ms each.

A model never decides whether the cube gets solved. At each step it is asked
**one typed question — read the cube**: where the piece being worked on is
sitting and which way it faces, or which case the last layer is in. The browser
already knows the answer, so every reply is scored, and the algorithm played
comes from the solver either way. **Solve using Kimi** and **Solve using Jev**
run the identical loop with the identical question; only the model differs.

The overlay shows exactly that: the stage and the piece, the model's reading with
its probability, a tick or a cross once the code checks it, then the algorithm and
how long the call took.

### What the two models do with it

| | Jev (TypeSafe) | Kimi k2.6 (Moonshot) |
| --- | --- | --- |
| kind | typed decision, `choice` | text model, JSON reply |
| latency | ~350ms | ~1,100ms |
| cost per read | $0.00006 | $0.001 |
| rate limit | 1,200/min | a few per minute, so its turns are paced 20s apart |
| reading the cube | 85% right over a full solve | roughly half right |
| confidence | 0.4-0.8, and it tracks being right | 1.00 on every answer, right or wrong |

A full Jev solve: 14.8s, 112 moves, 13 reads at 85%, $0.0007. The same solve with
Kimi takes minutes, because Moonshot's limit forces a 20s gap between questions.

Asking either model to *choose the moves* does not work, and it is worth saying
why: TypeSafe's own documentation is explicit that System One models "do not
write replies, produce code, or generate explanations", and an earlier version of
this app that asked Jev to pick one of the 18 face turns got a nearly flat
distribution and a cube that turned `U` forever. Search belongs in the code;
judgement belongs in the model.

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
