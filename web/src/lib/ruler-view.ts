// A régua de ajuste fino (ADR-0010), no app. A física é a do core
// (core/src/ruler.ts); aqui ficam o modelo do gesto, que decide o que vai para a
// placa, e o desenho no canvas. O caminho quente fica fora do Svelte: um laço de
// requestAnimationFrame só redesenha o canvas (ADR-0009).
//
// Posições em "traços" relativos a `base`, a posição da régua quando ela se
// assentou pela última vez; valor de máquina = base + traços × passo.

import {
  OVERSCROLL_RESISTANCE,
  ReportBuffer,
  clickFor,
  displayValue,
  dragDelta,
  glidePosition,
  planRelease,
  velocityFromSamples,
  type Axis,
  type AxisLimits,
  type Sample,
} from '@rlight/core';
import type { MachineState } from '@rlight/core';
import type { CommandRequest } from './connection';
import { speedText, speedVisible, wallsFor } from './motion-look';
import { NudgeBatcher } from './nudges';
import { formatMm } from './present';
import { BASE_PX_PER_TICK, approach, labelEvery, pxPerTick, reachOf, tickReachable, travelBand } from './ruler-geometry';

export const PX_PER_TICK = BASE_PX_PER_TICK;
const SETTLE_MS = 55;
/** Um toque, não um arrasto: anda menos que isto e dura menos que aquilo. */
const TAP_SLOP_PX = 8;
const TAP_MS = 350;
/** Depois de um gesto, a régua espera o servidor confirmar o alvo antes de voltar a seguir a máquina. */
const EXPECT_MS = 2_500;

export type RulerMode = 'rest' | 'drag' | 'glide' | 'settle';

export interface RulerDeps {
  send: (req: CommandRequest) => void;
  click: (kind: 'major' | 'minor' | 'wall') => void;
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
  /**
   * O zero da peça, em coordenada de máquina, quando a régua é a do Z. Um gesto
   * que começou acima dele para nele; para descer além é preciso um gesto novo,
   * de propósito, já na superfície (zBarrier do core, VISION.md).
   */
  barrier: number | null = null;
  /** A máquina está andando: um toque na régua, sem arrastar, é o Parar dela. */
  machineMoving = false;
  /** Px por traço agora; a vista o ajusta ao passo (ruler-geometry). */
  spacing = PX_PER_TICK;

  #glideFrom = 0;
  #glideStart = 0;
  #samples: Sample[] = [];
  #lastX = 0;
  #lastFrame = 0;
  #clickTick = 0;
  #sentTick = 0;
  #batcher: NudgeBatcher;
  #expect: { value: number; until: number } | null = null;
  #startAbove = false;
  #tap: { x: number; t: number } | null = null;
  #atBarrier = false;

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

  /** `value` é a posição real do eixo novo: o reportado do antigo não vale mais. */
  setAxis(axis: Axis, value: number): void {
    this.axis = axis;
    this.reported = value;
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

  /** O traço da barreira, ou null sem barreira. Arredonda para cima: nunca passa da superfície. */
  get barrierTick(): number | null {
    if (this.barrier === null) return null;
    return Math.ceil(r6((this.barrier - this.base) / this.step) - 1e-9);
  }

  down(x: number, t: number): void {
    this.#tap = this.mode === 'rest' && this.machineMoving ? { x, t } : null;
    if (this.mode === 'glide') this.#catch();
    this.#startAbove = this.barrier !== null && this.value > this.barrier + 1e-6;
    this.#atBarrier = false;
    this.mode = 'drag';
    this.target = null;
    this.#samples = [{ t, x }];
    this.#lastX = x;
  }

  move(x: number, t: number): void {
    if (this.mode !== 'drag') return;
    const d = dragDelta({ dxPx: x - this.#lastX, pxPerTick: this.spacing, pos: this.pos, minTick: this.minTick, maxTick: this.maxTick });
    this.#lastX = x;
    this.pos = this.#barrierClamp(this.pos + this.#leadResist(d));
    this.#samples.push({ t, x });
    while (this.#samples.length > 2 && t - this.#samples[0]!.t > 120) this.#samples.shift();
    this.#queueTicks(t);
  }

  up(t: number): void {
    if (this.mode !== 'drag') return;
    const tap = this.#tap;
    this.#tap = null;
    if (tap && Math.abs(this.#lastX - tap.x) < TAP_SLOP_PX && t - tap.t < TAP_MS) {
      // Um toque com a máquina andando para tudo, sem overlay: a régua é o Parar.
      this.#batcher.discard();
      this.deps.send({ command: 'cancelJog' });
      this.#expect = null;
      this.#reset(this.reported ?? this.value);
      return;
    }
    const pxPerMs = velocityFromSamples(this.#samples);
    const velocity = this.canGlide ? -pxPerMs / this.spacing : 0;
    const bt = this.#startAbove ? this.barrierTick : null;
    const plan = planRelease({ pos: this.pos, velocity, minTick: bt === null ? this.minTick : Math.max(this.minTick, bt), maxTick: this.maxTick });
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
      // Solto no elástico, a régua volta até onde a máquina pode ir agora.
      this.target = this.#withinLead(plan.target);
      this.mode = 'settle';
      this.#flushTo(this.target, t);
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
      // Só o que o dedo arrastou sai; com o dedo parado, nada vai para a placa.
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
    const tick = this.#withinLead(Math.round(Math.min(this.maxTick, Math.max(this.minTick, this.pos))));
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
   * O alcance, em traços: a posição real mais ou menos leadForStep (core, a mesma
   * regra do servidor), dentro do curso. Além dele a régua pesa, com o elástico do
   * iOS, e nada vai para a placa. Conforme a máquina anda, o alcance anda junto.
   */
  reachTicks(): { lo: number; hi: number } | null {
    if (this.reported === null) return null;
    const r = reachOf(this.reported, this.step, this.limits);
    return { lo: Math.ceil(r6((r.lo - this.base) / this.step) - 1e-9), hi: Math.floor(r6((r.hi - this.base) / this.step) + 1e-9) };
  }

  #leadWindow(): { lo: number; hi: number } | null {
    return this.reachTicks();
  }

  #leadResist(d: number): number {
    const w = this.#leadWindow();
    if (!w) return d;
    if ((d > 0 && this.pos >= w.hi) || (d < 0 && this.pos <= w.lo)) return d * OVERSCROLL_RESISTANCE;
    return d;
  }

  #withinLead(tick: number): number {
    const w = this.#leadWindow();
    if (!w) return tick;
    const lo = Math.min(w.lo, this.#sentTick);
    const hi = Math.max(w.hi, this.#sentTick);
    return Math.min(hi, Math.max(lo, tick));
  }

  #barrierClamp(next: number): number {
    const bt = this.#startAbove ? this.barrierTick : null;
    if (bt === null || next >= bt) {
      if (bt !== null && next > bt + 0.5) this.#atBarrier = false;
      return next;
    }
    if (!this.#atBarrier) this.deps.click('wall');
    this.#atBarrier = true;
    return bt;
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
  /** A posição real, deslizando entre relatórios como o DRO (ADR-0009). */
  readonly #machine = new ReportBuffer();
  #sp = PX_PER_TICK;
  #lastNow = 0;
  frozen = false;
  /** Estado e velocidade reportados: nos passos grandes, a velocidade real aparece na régua. */
  state: MachineState | null = null;
  feed = 0;
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

  pushReported(value: number, at: number): void {
    this.#machine.push({ at, value });
    this.#dirty = true;
  }

  clearReported(): void {
    this.#machine.clear();
  }

  start(): void {
    const frame = (now: number) => {
      // O espaçamento vai ao do passo com uma mola; o valor sob a linha não muda.
      const target = pxPerTick(this.model.step, this.#w / 2);
      if (this.#sp !== target) {
        this.#sp = approach(this.#sp, target, Math.min(64, now - this.#lastNow));
        this.model.spacing = this.#sp;
        this.#dirty = true;
      }
      this.#lastNow = now;
      // Enquanto a máquina anda, o marcador dela anda.
      if (this.model.machineMoving) this.#dirty = true;
      if (this.model.frame(now)) this.#dirty = true;
      if (this.#dirty) {
        this.#draw(now);
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

  #draw(now: number): void {
    const g = this.#g;
    const m = this.model;
    const W = this.#w;
    const H = this.#h;
    const SP = this.#sp;
    const fine = SP <= PX_PER_TICK + 0.5;
    const every = fine ? 10 : labelEvery(SP, 80);
    const reachT = m.reachTicks();
    g.clearRect(0, 0, W, H);
    g.font = '600 13px ui-monospace, "SF Mono", monospace';
    g.textAlign = 'center';
    const cx = W / 2;
    const base = H * 0.64;
    const first = Math.floor(m.pos - cx / SP) - 1;
    const last = Math.ceil(m.pos + cx / SP) + 1;
    const minT = m.minTick;
    const maxT = m.maxTick;
    // O que falta andar: uma faixa entre a linha azul (o alvo) e a máquina.
    const items = this.#machine.items;
    const machine = this.frozen ? (items[items.length - 1]?.value ?? null) : displayValue(items, now, 120);
    const band = machine === null ? null : travelBand({ target: m.value, machine, step: m.step, spacing: SP });
    if (band) {
      g.fillStyle = 'rgba(127,176,255,.14)';
      g.fillRect(cx + band.from, base - 50, band.to - band.from, 56);
    }
    for (let i = first; i <= last; i++) {
      const x = cx + (i - m.pos) * SP;
      // Fora do curso ou fora do alcance agora: o traço aparece, apagado, e não se usa.
      const outside = i < minT || i > maxT || (reachT !== null && !tickReachable(i, reachT));
      const dist = Math.abs(x - cx) / cx;
      const a = Math.max(0, 1 - dist * dist);
      const major = i % every === 0;
      const mid = fine && i % 5 === 0;
      g.globalAlpha = (outside ? 0.08 : 0.22) + (outside ? 0.12 : 0.78) * a;
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
    // As paredes, em âmbar: o início e o fim do curso em todo eixo e, no Z, a
    // superfície da peça. O rótulo fica do lado de dentro.
    for (const wall of wallsFor(m.limits, m.barrier)) {
      const bx = cx + ((wall.value - m.base) / m.step - m.pos) * SP;
      if (bx < -40 || bx > W + 40) continue;
      g.fillStyle = '#ffb454';
      g.fillRect(bx - 1.5, base - 52, 3, 60);
      g.font = '600 11px ui-monospace, "SF Mono", monospace';
      const inward = wall.kind === 'zero' || (m.limits !== null && wall.value === m.limits.min) ? 1 : -1;
      g.textAlign = inward > 0 ? 'left' : 'right';
      g.fillText(wall.kind === 'zero' ? 'Z0' : 'fim', bx + inward * 6, base - 40);
      g.textAlign = 'center';
      g.font = '600 13px ui-monospace, "SF Mono", monospace';
    }
    g.fillStyle = '#7fb0ff';
    g.fillRect(cx - 1.5, base - 58, 3, 66);
    // A máquina de verdade: um marcador branco, menor, que alcança a linha azul.
    if (machine !== null) {
      const mx = cx + ((machine - m.base) / m.step - m.pos) * SP;
      if (mx > -6 && mx < W + 6) {
        g.fillStyle = '#f2f4f7';
        g.fillRect(mx - 1, base - 34, 2, 40);
        g.beginPath();
        g.arc(mx, base - 38, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      // Nos passos grandes o movimento é longo: a velocidade real, ao lado da máquina.
      if (m.step >= 1 && !this.frozen && speedVisible(this.state, this.feed)) {
        const sx = Math.min(W - 8, Math.max(8, mx));
        g.font = '600 11px ui-monospace, "SF Mono", monospace';
        g.fillStyle = 'rgba(242,244,247,.85)';
        g.textAlign = sx < W / 2 ? 'left' : 'right';
        g.fillText(speedText(this.feed), sx + (sx < W / 2 ? 8 : -8), base - 44);
        g.textAlign = 'center';
        g.font = '600 13px ui-monospace, "SF Mono", monospace';
      }
    }
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
