// Imperative 3D layer. React owns the chrome; this owns the 26 cubie elements,
// their transforms and the turn animation, and reports state back through onChange.
import {
  COLOR,
  FACE_ORDER,
  TURN,
  applyTurn,
  createCubies,
  invert,
  isSolved,
  layerOf,
  randomScramble,
  facelets,
  restore,
  stickersHome,
} from './cube';

const HOME_VIEW = { x: -24, y: -34 };
const BACK_VIEW = { x: -24, y: -214 };

function translate(p) {
  return `translate3d(calc(var(--u) * ${p[0]}), calc(var(--u) * ${-p[1]}), calc(var(--u) * ${p[2]}))`;
}

export class CubeScene {
  constructor(stage, onChange) {
    this.stage = stage;
    this.onChange = onChange;
    this.cubies = createCubies();
    this.history = [];
    this.queue = [];
    this.busy = false;
    this.duration = 220;
    this.timers = new Set();
    this.idleWaiters = [];
    this.turns = 0; // every physical turn performed, undos included
    this.reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.rotX = HOME_VIEW.x;
    this.rotY = HOME_VIEW.y;
    this.dragging = false;
    this.last = { x: 0, y: 0 };

    this.buildDom();
    this.applyCamera();
    this.paint();
    this.bindDrag();
    this.emit();
  }

  /* ---------- dom ---------- */

  buildDom() {
    this.cubeEl = document.createElement('div');
    this.cubeEl.className = 'cube';
    const frag = document.createDocumentFragment();

    for (const c of this.cubies) {
      const el = document.createElement('div');
      el.className = 'cubie';
      c.stickers = {};
      for (const f of FACE_ORDER) {
        const face = document.createElement('div');
        face.className = `face f-${f}`;
        const sticker = document.createElement('i');
        c.stickers[f] = sticker;
        face.appendChild(sticker);
        el.appendChild(face);
      }
      el.style.transform = translate(c.pos);
      c.el = el;
      frag.appendChild(el);
    }

    this.cubeEl.appendChild(frag);
    this.stage.appendChild(this.cubeEl);
  }

  paint() {
    for (const c of this.cubies) {
      for (const f of FACE_ORDER) {
        const color = c.colors[f];
        const sticker = c.stickers[f];
        sticker.hidden = !color;
        if (color) sticker.style.background = COLOR[color];
      }
    }
  }

  /** Snap every cubie to its model position without animating. */
  syncTransforms(cubies = this.cubies) {
    for (const c of cubies) {
      c.el.style.transition = 'none';
      c.el.style.transform = translate(c.pos);
    }
    void this.cubeEl.offsetWidth; // flush, so the next frame animates again
    for (const c of cubies) c.el.style.transition = '';
  }

  /** Current sticker state, the only thing the solver ever sees. */
  snapshot() {
    return { facelets: facelets(this.cubies), stickersHome: stickersHome(this.cubies) };
  }

  /** Queue a batch and resolve once every turn has finished animating. */
  applyMoves(moves) {
    for (const m of moves) this.push(m.face, m.amount);
    return this.idle();
  }

  idle() {
    if (!this.busy && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  stopQueue() {
    this.queue.length = 0;
    return this.idle();
  }

  emit() {
    if (!this.busy && !this.queue.length && this.idleWaiters.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
    this.onChange({
      history: this.history.map((m) => ({ ...m })),
      solved: isSolved(this.cubies),
      busy: this.busy || this.queue.length > 0,
    });
  }

  after(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  /* ---------- moves ---------- */

  push(face, amount) {
    if (this.queue.length > 240) return;
    const move = { face, amount };
    this.history.push(move); // log immediately; the turn animates after
    this.queue.push(move);
    this.drain();
    this.emit();
  }

  drain() {
    if (this.busy || !this.queue.length) return;
    this.run(this.queue.shift());
  }

  run(move) {
    const t = TURN[move.face];
    const layer = layerOf(this.cubies, move.face);
    const deg = t.deg * (move.amount === 2 ? 2 : move.amount);
    const ms = this.reduce ? 0 : this.duration;

    const settle = () => {
      applyTurn(this.cubies, move.face, move.amount);
      this.turns += 1;
      this.syncTransforms(layer);
      this.paint();
      this.busy = false;
      this.emit();
      this.drain();
    };

    if (ms === 0) {
      settle();
      return;
    }

    this.busy = true;
    for (const c of layer) {
      c.el.style.transition = `transform ${ms}ms cubic-bezier(.36,.06,.2,1)`;
      c.el.style.transform = `${t.css}(${deg}deg) ${translate(c.pos)}`;
    }
    this.after(ms + 10, settle);
  }

  scramble() {
    if (this.busy) return this.after(this.duration + 20, () => this.scramble());
    this.queue.length = 0;
    this.history = randomScramble(25);
    restore(this.cubies);
    for (const m of this.history) applyTurn(this.cubies, m.face, m.amount);
    this.syncTransforms();
    this.paint();
    this.emit();
  }

  undo() {
    if (this.busy || this.queue.length || !this.history.length) return;
    const last = this.history.pop();
    this.run(invert(last));
    this.emit();
  }

  reset() {
    if (this.busy) return this.after(this.duration + 20, () => this.reset());
    this.queue.length = 0;
    this.history = [];
    restore(this.cubies);
    this.syncTransforms();
    this.paint();
    this.emit();
  }

  setDuration(ms) {
    this.duration = ms;
  }

  /* ---------- camera ---------- */

  applyCamera() {
    this.cubeEl.style.transform = `rotateX(${this.rotX}deg) rotateY(${this.rotY}deg)`;
  }

  glide(view) {
    this.cubeEl.style.transition = this.reduce ? 'none' : 'transform .5s cubic-bezier(.3,.7,.2,1)';
    this.rotX = view.x;
    this.rotY = view.y;
    this.applyCamera();
    this.after(520, () => {
      this.cubeEl.style.transition = '';
    });
  }

  home() {
    this.glide(HOME_VIEW);
  }

  back() {
    this.glide(BACK_VIEW);
  }

  bindDrag() {
    this.onDown = (e) => {
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.stage.setPointerCapture(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.dragging) return;
      this.rotY += (e.clientX - this.last.x) * 0.4;
      this.rotX = Math.max(-85, Math.min(85, this.rotX - (e.clientY - this.last.y) * 0.4));
      this.last = { x: e.clientX, y: e.clientY };
      this.applyCamera();
    };
    this.onUp = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      try {
        this.stage.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    };
    this.stage.addEventListener('pointerdown', this.onDown);
    this.stage.addEventListener('pointermove', this.onMove);
    this.stage.addEventListener('pointerup', this.onUp);
    this.stage.addEventListener('pointercancel', this.onUp);
  }

  destroy() {
    this.queue.length = 0;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters = [];
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.stage.removeEventListener('pointerdown', this.onDown);
    this.stage.removeEventListener('pointermove', this.onMove);
    this.stage.removeEventListener('pointerup', this.onUp);
    this.stage.removeEventListener('pointercancel', this.onUp);
    this.cubeEl.remove();
  }
}
