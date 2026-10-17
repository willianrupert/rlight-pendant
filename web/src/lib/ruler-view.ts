// A régua de ajuste fino (ADR-0010), no app. A física é a do core
// (core/src/ruler.ts); aqui ficam o modelo do gesto, que decide o que vai para a
// placa, e o desenho no canvas. O caminho quente fica fora do Svelte: um laço de
// requestAnimationFrame só redesenha o canvas (ADR-0009).
//
// Posições em "traços" relativos a `base`, a posição da régua quando ela se
// assentou pela última vez; valor de máquina = base + traços × passo.

import {
  DEFAULT_MAX_LEAD_MM,
  clickFor,
  dragDelta,
  glidePosition,
  planRelease,
  velocityFromSamples,
  type Axis,
  type AxisLimits,
  type Sample,
} from '@rlight/core';
import type { CommandRequest } from './connection';
import { NudgeBatcher } from './nudges';
import { formatMm } from './present';

export const PX_PER_TICK = 22;
const SETTLE_MS = 55;
/** Depois de um gesto, a régua espera o servidor confirmar o alvo antes de voltar a seguir a máquina. */
const EXPECT_MS = 2_500;

export type RulerMode = 'rest' | 'drag' | 'glide' | 'settle';

export interface RulerDeps {
  send: (req: CommandRequest) => void;
  click: (kind: 'major' | 'minor') => void;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export class RulerModel {
  axis: Axis;
  step: number;
  base = 0;
  pos = 0;
  mode: RulerMode = 'rest';
  target: number | null = null;
  /** Sem homing não há destino anunciado: a régua só arrasta (`jogAxisTo` exige homing). */
  canGlide = true;
  limits: AxisLimits | null = null;
  /** A última posição real da máquina neste eixo. */
  reported: number | null = null;

  #glideFrom = 0;
  #glideStart = 0;
  #samples: Sample[] = [];
  #lastX = 0;
  #lastFrame = 0;
  #clickTick = 0;
  #sentTick = 0;
  #batcher: NudgeBatcher;
  #expect: { value: number; until: number } | null = null;

  constructor(
    axis: Axis,
    step: number,
    private readonly deps: RulerDeps,
  ) {
    this.axis = axis;
    this.step = step;
    this.#batcher = new NudgeBatcher(axis, step);
  }

  get minTick(): number {
    return this.limits ? Math.ceil(r6((this.limits.min - this.base) / this.step)) : -Infinity;
  }

  get maxTick(): number {
    return this.limits ? Math.floor(r6((this.limits.max - this.base) / this.step)) : Infinity;
  }

  /** O valor de máquina sob a linha agora. */
  get value(): number {
    return r6(this.base + this.pos * this.step);
  }

  /** O destino anunciado, em valor de máquina, enquanto a régua desliza. */
  get destination(): number | null {
    return this.mode === 'glide' && this.target !== null ? r6(this.base + this.target * this.step) : null;
  }

  get busy(): boolean {
    return this.mode !== 'rest';
  }

  /**
   * A régua parada segue a máquina (o alvo comandado ou a posição real). Logo
   * depois de um gesto ela espera o servidor confirmar o alvo que mandou, para
   * não voltar ao valor antigo e pular de novo.
   */
  sync(value: number, now: number): void {
    if (this.mode !== 'rest') return;
    if (this.#expect) {
      if (Math.abs(value - this.#expect.value) > 0.0015 && now < this.#expect.until) return;
      this.#expect = null;
    }
    if (Math.abs(value - this.value) < 1e-6 && this.pos === 0) return;
    this.#rebase(value);
  }

  setAxis(axis: Axis, value: number): void {
    this.axis = axis;
    this.#batcher = new NudgeBatcher(axis, this.step);
    this.#expect = null;
    this.#reset(value);
  }

  setStep(step: number): void {
    this.step = step;
    this.#batcher = new NudgeBatcher(this.axis, step);
    this.#reset(this.value);
  }

  /** O sinal caiu ou o controle saiu: nada pendente vai para a placa depois. */
  abort(): void {
    this.#batcher.discard();
    this.#expect = null;
    this.#reset(this.reported ?? this.value);
  }

  down(x: number, t: number): void {
    if (this.mode === 'glide') this.#catch();
    this.mode = 'drag';
    this.target = null;
    this.#samples = [{ t, x }];
    this.#lastX = x;
  }

  move(x: number, t: number): void {
    if (this.mode !== 'drag') return;
    const d = dragDelta({ dxPx: x - this.#lastX, pxPerTick: PX_PER_TICK, pos: this.pos, minTick: this.minTick, maxTick: this.maxTick });
    this.#lastX = x;
    this.pos = this.#leadClamp(this.pos + d, d);
    this.#samples.push({ t, x });
    while (this.#samples.length > 2 && t - this.#samples[0]!.t > 120) this.#samples.shift();
    this.#queueTicks(t);
  }

  up(t: number): void {
    if (this.mode !== 'drag') return;
    const pxPerMs = velocityFromSamples(this.#samples);
    const velocity = this.canGlide ? -pxPerMs / PX_PER_TICK : 0;
    const plan = planRelease({ pos: this.pos, velocity, minTick: this.minTick, maxTick: this.maxTick });
    this.target = plan.target;
    if (plan.kind === 'glide') {
      // Um único comando absoluto para o destino anunciado (ADR-0002).
      this.#batcher.discard();
      this.mode = 'glide';
      this.#glideFrom = this.pos;
      this.#glideStart = t;
      const value = r6(this.base + plan.target * this.step);
      this.#sentTick = plan.target;
      this.#expectValue(value, t);
      this.deps.send({ command: 'jogAxisTo', axis: this.axis, value });
    } else {
      this.mode = 'settle';
      this.#flushTo(plan.target, t);
    }
  }

  /** Um quadro. Devolve se é preciso redesenhar. */
  frame(now: number): boolean {
    const dt = Math.min(64, Math.max(0, now - this.#lastFrame));
    this.#lastFrame = now;
    let dirty = this.mode !== 'rest';
    if (this.mode === 'glide' && this.target !== null) {
      this.pos = glidePosition({ from: this.#glideFrom, target: this.target, elapsedMs: now - this.#glideStart });
      if (this.pos === this.target) this.#settled();
    } else if (this.mode === 'settle' && this.target !== null) {
      const d = this.target - this.pos;
      this.pos += d * (1 - Math.exp(-dt / SETTLE_MS));
      if (Math.abs(d) < 0.002) this.#settled();
    } else if (this.mode === 'drag') {
      const cmd = this.#batcher.flush(now);
      if (cmd) this.deps.send(cmd);
    }
    const tick = Math.round(Math.min(this.maxTick, Math.max(this.minTick, this.pos)));
    if (tick !== this.#clickTick) {
      const gliding = this.mode === 'glide';
      const kind = clickFor({ tick, gliding, ticksToTarget: gliding && this.target !== null ? this.target - this.pos : 0 });
      if (kind) this.deps.click(kind);
      this.#clickTick = tick;
      dirty = true;
    }
    return dirty;
  }

  /** Tocar durante o deslize segura a régua no traço mais próximo. */
  #catch(): void {
    const caught = Math.round(Math.min(this.maxTick, Math.max(this.minTick, this.pos)));
    this.pos = caught;
    this.#sentTick = caught;
    const value = r6(this.base + caught * this.step);
    this.deps.send({ command: 'cancelJog' });
    this.deps.send({ command: 'jogAxisTo', axis: this.axis, value });
    this.#expectValue(value, this.#lastFrame);
  }

  #queueTicks(t: number): void {
    const tick = Math.round(Math.min(this.maxTick, Math.max(this.minTick, this.pos)));
    if (tick === this.#sentTick) return;
    this.#batcher.add(tick - this.#sentTick, t);
    this.#sentTick = tick;
  }

  #flushTo(tick: number, t: number): void {
    if (tick !== this.#sentTick) this.#batcher.add(tick - this.#sentTick, t);
    this.#sentTick = tick;
    const cmd = this.#batcher.flush(t, true);
    if (cmd) {
      this.#expectValue(r6(this.base + tick * this.step), t);
      this.deps.send(cmd);
    }
  }

  /**
   * A régua não fica mais de 2 mm à frente da máquina (ADR-0002): ela pesa e
   * não avança mais. Voltar em direção à máquina sempre pode.
   */
  #leadClamp(next: number, delta: number): number {
    if (this.reported === null) return next;
    const lead = Math.floor(r6((DEFAULT_MAX_LEAD_MM - 1e-6) / this.step));
    const here = r6((this.reported - this.base) / this.step);
    const lo = here - lead;
    const hi = here + lead;
    if (delta > 0 && next > hi) return Math.max(this.pos, hi);
    if (delta < 0 && next < lo) return Math.min(this.pos, lo);
    return next;
  }

  #expectValue(value: number, t: number): void {
    this.#expect = { value, until: t + EXPECT_MS };
  }

  #settled(): void {
    const v = r6(this.base + this.target! * this.step);
    this.mode = 'rest';
    this.target = null;
    this.#rebase(v);
    this.#expectValue(v, this.#lastFrame);
  }

  #rebase(value: number): void {
    this.base = value;
    this.pos = 0;
    this.#sentTick = 0;
    this.#clickTick = 0;
  }

  #reset(value: number): void {
    this.mode = 'rest';
    this.target = null;
    this.#rebase(value);
  }
}

/** Desenha a régua num canvas que segue a densidade da tela. */
export class RulerView {
  readonly #canvas: HTMLCanvasElement;
  readonly #g: CanvasRenderingContext2D;
  #w = 0;
  #h = 0;
  #dpr = 1;
  #raf = 0;
  #dirty = true;
  #ro: ResizeObserver;
  /** Offset do zero da peça: os números da régua são os mesmos do DRO. */
  offset = 0;
  enabled = true;
  onFrame: ((model: RulerModel) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    readonly model: RulerModel,
  ) {
    this.#canvas = canvas;
    this.#g = canvas.getContext('2d')!;
    this.#ro = new ResizeObserver(() => this.#resize());
    this.#ro.observe(canvas);
    this.#resize();
    canvas.addEventListener('pointerdown', this.#down);
    canvas.addEventListener('pointermove', this.#move);
    canvas.addEventListener('pointerup', this.#up);
    canvas.addEventListener('pointercancel', this.#up);
  }

  start(): void {
    const frame = (now: number) => {
      if (this.model.frame(now)) this.#dirty = true;
      if (this.#dirty) {
        this.#draw();
        this.#dirty = false;
        this.onFrame?.(this.model);
      }
      this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  invalidate(): void {
    this.#dirty = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#ro.disconnect();
    this.#canvas.removeEventListener('pointerdown', this.#down);
    this.#canvas.removeEventListener('pointermove', this.#move);
    this.#canvas.removeEventListener('pointerup', this.#up);
    this.#canvas.removeEventListener('pointercancel', this.#up);
  }

  #down = (e: PointerEvent) => {
    if (!this.enabled) return;
    try {
      this.#canvas.setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    this.model.down(e.clientX, e.timeStamp);
    this.#dirty = true;
  };

  #move = (e: PointerEvent) => {
    if (this.model.mode !== 'drag') return;
    const evs = e.getCoalescedEvents?.() ?? [e];
    for (const ev of evs.length ? evs : [e]) this.model.move(ev.clientX, ev.timeStamp);
    this.#dirty = true;
  };

  #up = (e: PointerEvent) => {
    this.model.up(e.timeStamp);
    this.#dirty = true;
  };

  #resize(): void {
    this.#dpr = Math.min(3, window.devicePixelRatio || 1);
    this.#w = this.#canvas.clientWidth;
    this.#h = this.#canvas.clientHeight;
    this.#canvas.width = Math.round(this.#w * this.#dpr);
    this.#canvas.height = Math.round(this.#h * this.#dpr);
    this.#g.setTransform(this.#dpr, 0, 0, this.#dpr, 0, 0);
    this.#dirty = true;
  }

  #draw(): void {
    const g = this.#g;
    const m = this.model;
    const W = this.#w;
    const H = this.#h;
    const SP = PX_PER_TICK;
    g.clearRect(0, 0, W, H);
    g.font = '600 13px ui-monospace, "SF Mono", monospace';
    g.textAlign = 'center';
    const cx = W / 2;
    const base = H * 0.64;
    const first = Math.floor(m.pos - cx / SP) - 1;
    const last = Math.ceil(m.pos + cx / SP) + 1;
    const minT = m.minTick;
    const maxT = m.maxTick;
    for (let i = first; i <= last; i++) {
      const x = cx + (i - m.pos) * SP;
      const outside = i < minT || i > maxT;
      const dist = Math.abs(x - cx) / cx;
      const a = Math.max(0, 1 - dist * dist);
      const major = i % 10 === 0;
      const mid = i % 5 === 0;
      g.globalAlpha = (outside ? 0.1 : 0.22) + (outside ? 0.15 : 0.78) * a;
      g.fillStyle = major ? '#d4dbe4' : '#6b7480';
      const h = major ? 44 : mid ? 30 : 18;
      const w = major ? 2.5 : 2;
      g.fillRect(Math.round(x * this.#dpr) / this.#dpr - w / 2, base - h, w, h);
      if (major && !outside) {
        g.fillStyle = '#9aa3ae';
        g.fillText(formatMm(m.base + i * m.step - this.offset), x, base + 22);
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = '#7fb0ff';
    g.fillRect(cx - 1.5, base - 58, 3, 66);
    if (m.mode === 'glide' && m.target !== null) {
      // O destino anunciado, como número, preso à borda quando está fora da tela.
      const tx = cx + (m.target - m.pos) * SP;
      const dir = m.target > m.pos ? 1 : -1;
      const label = (dir > 0 ? '→ ' : '← ') + formatMm(m.base + m.target * m.step - this.offset);
      const lw = g.measureText(label).width + 18;
      const lh = 24;
      const px = Math.min(W - lw / 2 - 8, Math.max(lw / 2 + 8, tx));
      const py = 6;
      g.fillStyle = '#7fb0ff';
      g.beginPath();
      if (g.roundRect) g.roundRect(px - lw / 2, py, lw, lh, 12);
      else g.rect(px - lw / 2, py, lw, lh);
      g.fill();
      g.fillStyle = '#0b1a33';
      g.fillText(label, px, py + 16.5);
      if (tx > 0 && tx < W) {
        g.fillStyle = 'rgba(127,176,255,.55)';
        g.fillRect(tx - 1, py + lh, 2, base - py - lh);
      }
    }
  }
}
