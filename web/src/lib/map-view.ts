// O mapa da mesa, visto de cima, com o fantasma (ADR-0002). Arrastar o fantasma
// não move a máquina; soltar manda um único `jogTo`. O modelo do gesto é puro;
// o desenho escreve direto em atributos do SVG num laço de rAF, fora do Svelte.

import { ReportBuffer, displayValue, goTo, type AxisLimits } from '@rlight/core';
import type { MachineState } from '@rlight/core';
import { heading, speedText, speedVisible, trailPx } from './motion-look';
import { formatMm } from './present';

export interface TableLimits {
  x: AxisLimits;
  y: AxisLimits;
}

export interface Point {
  x: number;
  y: number;
}

/** Fora da mesa, o fantasma anda cada vez menos, como o elástico do iOS. */
export function rubber(v: number, min: number, max: number, dim: number): number {
  const band = (over: number) => (1 - 1 / ((over * 0.55) / dim + 1)) * dim;
  if (v < min) return min - band(min - v);
  if (v > max) return max + band(v - max);
  return v;
}

/** Menos que isto não é um gesto, é um toque: nada vai para a placa. */
export const MIN_MOVE_MM = 1;
/** Perto assim do alvo, com a máquina parada, ela chegou. */
export const ARRIVED_MM = 0.5;
/** Sem ver a máquina andar até aqui depois do "Ir", o jog não começou (recusado ou perdido). */
const NEVER_STARTED_MS = 1_500;
export class GhostModel {
  limits: TableLimits;
  dragging = false;
  /** Onde o fantasma está desenhado (com o elástico fora da mesa). */
  ghost: Point | null = null;
  /**
   * Um toque na mesa põe o fantasma lá e espera o "Ir": um toque sozinho nunca
   * move a máquina pela mesa (ADR-0005). Arrastar e soltar continua indo direto.
   */
  preview: Point | null = null;
  /**
   * O alvo em curso: depois do "Ir" (ou de soltar o fantasma), ele fica na mesa até
   * a máquina chegar. Se ela parar antes, some na hora: o mapa nunca mostra um
   * destino que a máquina não vai mais buscar.
   */
  target: Point | null = null;
  #targetAt = 0;
  #sawMoving = false;
  #from: Point = { x: 0, y: 0 };
  #grab: Point = { x: 0, y: 0 };

  constructor(limits: TableLimits) {
    this.limits = limits;
  }

  /**
   * Pega o fantasma se o dedo caiu perto do ponto real. Um toque longe dele
   * não faz nada: um toque acidental nunca move a máquina.
   */
  down(finger: Point, real: Point, grabRadiusMm: number): boolean {
    if (Math.hypot(finger.x - real.x, finger.y - real.y) > grabRadiusMm) return false;
    this.dragging = true;
    this.preview = null;
    this.#from = { ...real };
    this.#grab = { ...finger };
    this.ghost = { ...real };
    return true;
  }

  move(finger: Point): void {
    if (!this.dragging) return;
    const { x, y } = this.limits;
    const rawX = this.#from.x + finger.x - this.#grab.x;
    const rawY = this.#from.y + finger.y - this.#grab.y;
    this.ghost = {
      x: rubber(rawX, x.min, x.max, (x.max - x.min) * 0.08),
      y: rubber(rawY, y.min, y.max, (y.max - y.min) * 0.08),
    };
  }

  /** O destino de verdade, sempre dentro da mesa. */
  get destination(): Point | null {
    if (!this.ghost) return null;
    return goTo(this.ghost, this.limits).target;
  }

  /** Soltar: o destino a mandar, ou null se foi só um toque. */
  up(): Point | null {
    if (!this.dragging) return null;
    this.dragging = false;
    const dest = this.destination;
    this.ghost = null;
    if (!dest) return null;
    if (Math.hypot(dest.x - this.#from.x, dest.y - this.#from.y) < MIN_MOVE_MM) return null;
    return dest;
  }

  cancel(): void {
    this.dragging = false;
    this.ghost = null;
    this.preview = null;
  }

  /**
   * Um toque na mesa: sem prévia, põe o fantasma no ponto tocado (dentro da
   * mesa); com prévia, um toque fora do "Ir" a desfaz.
   */
  tap(finger: Point, real: Point): Point | null {
    if (this.preview) {
      this.preview = null;
      return null;
    }
    const dest = goTo(finger, this.limits).target;
    if (Math.hypot(dest.x - real.x, dest.y - real.y) < MIN_MOVE_MM) return null;
    this.preview = dest;
    return dest;
  }

  setTarget(p: Point, now: number): void {
    this.target = { ...p };
    this.#targetAt = now;
    this.#sawMoving = false;
  }

  clearTarget(): void {
    this.target = null;
  }

  /**
   * A cada relatório: 'arrived' quando a máquina chegou e parou (o alvo esmaece),
   * 'stopped' quando parou em outro lugar ou nunca andou (o alvo some), null enquanto vai.
   */
  track(real: Point, state: MachineState | null, now: number): 'arrived' | 'stopped' | null {
    const t = this.target;
    if (!t) return null;
    if (state === 'Jog') {
      this.#sawMoving = true;
      return null;
    }
    if (Math.hypot(real.x - t.x, real.y - t.y) <= ARRIVED_MM && state === 'Idle') {
      this.target = null;
      return 'arrived';
    }
    if (this.#sawMoving || state === 'Alarm' || now - this.#targetAt > NEVER_STARTED_MS) {
      this.target = null;
      return 'stopped';
    }
    return null;
  }

  /** "Ir": o destino da prévia, uma vez. */
  go(): Point | null {
    const dest = this.preview;
    this.preview = null;
    return dest;
  }
}

const NS = 'http://www.w3.org/2000/svg';
const TAP_SLOP_PX = 8;

/** Margem, em px, nas pontas da régua vertical do Z (o CSS usa a mesma). */
const GAUGE_INSET = 10;

/** Perto assim do zero da peça, o ponto ganha o anel de "na superfície". */
export const AT_ZERO_MM = 0.05;

/**
 * Como a altura aparece vista de cima, sem 3D: o ponto encolhe e fica nítido
 * descendo, cresce e amacia subindo, como uma sombra. `depth` vai de 0 (topo do
 * curso) a 1 (fundo).
 */
export function zLook(z: number, limits: AxisLimits, zero: number | null): {
  depth: number;
  scale: number;
  softness: number;
  atZero: boolean;
  zeroDepth: number | null;
} {
  const span = Math.max(1e-6, limits.max - limits.min);
  const depth = Math.min(1, Math.max(0, (limits.max - z) / span));
  const inside = zero !== null && zero >= limits.min && zero <= limits.max;
  return {
    depth,
    scale: 1.3 - 0.55 * depth,
    softness: 1 - depth,
    atZero: zero !== null && Math.abs(z - zero) <= AT_ZERO_MM,
    zeroDepth: inside ? (limits.max - zero!) / span : null,
  };
}

/** A margem em volta da mesa, em mm, para o ponto na borda caber inteiro. */
export function mapPad(limits: TableLimits): number {
  return Math.max(limits.x.max - limits.x.min, limits.y.max - limits.y.min) * 0.04;
}

/**
 * Desenha a mesa num SVG cujo viewBox é a própria mesa em mm (Y para cima: o
 * fundo da mesa fica no alto da tela). O ponto real desliza entre relatórios
 * reais (ADR-0009), um relatório atrás.
 */
export class MapView {
  readonly #svg: SVGSVGElement;
  readonly #real: SVGCircleElement;
  readonly #ghost: SVGGElement;
  readonly #line: SVGLineElement;
  readonly #halo: SVGCircleElement;
  readonly #zring: SVGCircleElement;
  readonly #trail: SVGLineElement;
  readonly #speed: SVGTextElement;
  readonly #target: SVGGElement;
  readonly #targetLine: SVGLineElement;
  #fadeTimer: ReturnType<typeof setTimeout> | null = null;
  #speedShown = '';
  #recent: { x: number; y: number; t: number }[] = [];
  #tapStart: { x: number; y: number } | null = null;
  readonly #bz = new ReportBuffer();
  /** O estado e a velocidade que a placa reporta, para a velocidade e o rastro. */
  state: MachineState | null = null;
  feed = 0;
  #gauge: { root: HTMLElement; tool: HTMLElement; zero: HTMLElement; h: number; ro: ResizeObserver } | null = null;
  /** O curso do Z e o zero da peça em coordenada de máquina, quando conhecidos. */
  zLimits: AxisLimits | null = null;
  zZero: number | null = null;
  readonly #bx = new ReportBuffer();
  readonly #by = new ReportBuffer();
  #limits: TableLimits;
  #raf = 0;
  #shownReal: Point | null = null;
  #pointLow: boolean | null = null;
  model: GhostModel;
  /** Pode arrastar (com controle, com sinal, com homing, em repouso). */
  enabled = false;
  frozen = false;
  onGhost: ((dest: Point | null) => void) | null = null;
  onRelease: ((dest: Point) => void) | null = null;
  onGrab: (() => void) | null = null;
  /** O fantasma de um toque mudou (prévia posta ou desfeita). */
  onPreview: ((dest: Point | null) => void) | null = null;

  constructor(svg: SVGSVGElement, limits: TableLimits) {
    this.#svg = svg;
    this.#limits = limits;
    this.model = new GhostModel(limits);
    // A vista tem a proporção da mesa (CSS aspect-ratio), então a escala é uniforme.
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const grid = document.createElementNS(NS, 'g');
    grid.setAttribute('class', 'grid');
    this.#line = document.createElementNS(NS, 'line');
    this.#line.setAttribute('class', 'path');
    this.#halo = document.createElementNS(NS, 'circle');
    this.#halo.setAttribute('class', 'halo');
    this.#real = document.createElementNS(NS, 'circle');
    this.#real.setAttribute('class', 'real');
    this.#ghost = document.createElementNS(NS, 'g');
    this.#ghost.setAttribute('class', 'ghost');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', '1');
    this.#ghost.append(ring);
    this.#zring = document.createElementNS(NS, 'circle');
    this.#zring.setAttribute('class', 'zring');
    this.#trail = document.createElementNS(NS, 'line');
    this.#trail.setAttribute('class', 'trail');
    this.#speed = document.createElementNS(NS, 'text');
    this.#speed.setAttribute('class', 'speed');
    // O alvo em curso: um anel vazado na cor de destaque e o caminho que falta.
    this.#target = document.createElementNS(NS, 'g');
    this.#target.setAttribute('class', 'target');
    const tring = document.createElementNS(NS, 'circle');
    tring.setAttribute('r', '1');
    this.#target.append(tring);
    this.#target.style.display = 'none';
    this.#targetLine = document.createElementNS(NS, 'line');
    this.#targetLine.setAttribute('class', 'target-path');
    this.#targetLine.style.display = 'none';
    svg.append(grid, this.#targetLine, this.#line, this.#trail, this.#halo, this.#zring, this.#target, this.#real, this.#ghost, this.#speed);
    this.setLimits(limits);
    svg.addEventListener('pointerdown', this.#down);
    svg.addEventListener('pointermove', this.#move);
    svg.addEventListener('pointerup', this.#up);
    svg.addEventListener('pointercancel', this.#cancel);
  }

  setLimits(limits: TableLimits): void {
    this.#limits = limits;
    this.model.limits = limits;
    const { x, y } = limits;
    const w = x.max - x.min;
    const h = y.max - y.min;
    const pad = mapPad(limits);
    this.#svg.setAttribute('viewBox', `${x.min - pad} ${-y.max - pad} ${w + 2 * pad} ${h + 2 * pad}`);
    const grid = this.#svg.querySelector('.grid')!;
    grid.textContent = '';
    // A mesa é um retângulo dentro da vista: o ponto na borda do curso não é cortado.
    const bed = document.createElementNS(NS, 'rect');
    bed.setAttribute('class', 'bed');
    bed.setAttribute('x', String(x.min));
    bed.setAttribute('y', String(-y.max));
    bed.setAttribute('width', String(w));
    bed.setAttribute('height', String(h));
    grid.append(bed);
    const every = w > 600 ? 100 : w > 200 ? 50 : 10;
    for (let gx = Math.ceil(x.min / every) * every; gx <= x.max; gx += every) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', String(gx));
      l.setAttribute('x2', String(gx));
      l.setAttribute('y1', String(-y.max));
      l.setAttribute('y2', String(-y.min));
      grid.append(l);
    }
    for (let gy = Math.ceil(y.min / every) * every; gy <= y.max; gy += every) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', String(x.min));
      l.setAttribute('x2', String(x.max));
      l.setAttribute('y1', String(-gy));
      l.setAttribute('y2', String(-gy));
      grid.append(l);
    }
  }

  push(p: Point & { z?: number }, at: number): void {
    this.#bx.push({ at, value: p.x });
    this.#by.push({ at, value: p.y });
    if (p.z !== undefined) this.#bz.push({ at, value: p.z });
  }

  clear(): void {
    this.#bx.clear();
    this.#by.clear();
    this.#bz.clear();
  }

  /** A régua vertical do Z ao lado do mapa: o curso, a ferramenta e o zero da peça. */
  attachGauge(root: HTMLElement): void {
    const tool = document.createElement('span');
    tool.className = 'ztool';
    const zero = document.createElement('span');
    zero.className = 'zzero';
    root.append(zero, tool);
    const ro = new ResizeObserver(() => {
      if (this.#gauge) this.#gauge.h = Math.max(0, root.clientHeight - 2 * GAUGE_INSET);
    });
    ro.observe(root);
    this.#gauge = { root, tool, zero, h: Math.max(0, root.clientHeight - 2 * GAUGE_INSET), ro };
  }

  start(): void {
    const frame = (now: number) => {
      this.#draw(now);
      this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#gauge?.ro.disconnect();
    this.#svg.removeEventListener('pointerdown', this.#down);
    this.#svg.removeEventListener('pointermove', this.#move);
    this.#svg.removeEventListener('pointerup', this.#up);
    this.#svg.removeEventListener('pointercancel', this.#cancel);
  }

  /** Quantos mm de mesa cabem num px de tela (os eixos têm escalas próprias). */
  #mmPerPx(): Point {
    const r = this.#svg.getBoundingClientRect();
    const { x, y } = this.#limits;
    const pad = 2 * mapPad(this.#limits);
    return { x: (x.max - x.min + pad) / Math.max(1, r.width), y: (y.max - y.min + pad) / Math.max(1, r.height) };
  }

  #toTable(e: PointerEvent): Point {
    const r = this.#svg.getBoundingClientRect();
    const { x, y } = this.#limits;
    const pad = mapPad(this.#limits);
    return {
      x: x.min - pad + ((e.clientX - r.left) / Math.max(1, r.width)) * (x.max - x.min + 2 * pad),
      y: y.max + pad - ((e.clientY - r.top) / Math.max(1, r.height)) * (y.max - y.min + 2 * pad),
    };
  }

  /** Onde um ponto da mesa cai na vista, em px a partir do canto da vista. */
  toScreen(p: Point): { x: number; y: number } {
    const r = this.#svg.getBoundingClientRect();
    const { x, y } = this.#limits;
    const pad = mapPad(this.#limits);
    return {
      x: ((p.x - x.min + pad) / (x.max - x.min + 2 * pad)) * r.width,
      y: ((y.max + pad - p.y) / (y.max - y.min + 2 * pad)) * r.height,
    };
  }

  #down = (e: PointerEvent) => {
    if (!this.enabled || !this.#shownReal) return;
    const k = this.#mmPerPx();
    // Raio de pega de 40 px de tela, para o polegar de luva.
    const radius = 40 * Math.max(k.x, k.y);
    const hadPreview = this.model.preview !== null;
    if (!this.model.down(this.#toTable(e), this.#shownReal, radius)) {
      // Longe do ponto: pode ser um toque na mesa (prévia com "Ir").
      this.#tapStart = { x: e.clientX, y: e.clientY };
      return;
    }
    if (hadPreview) this.onPreview?.(null);
    try {
      this.#svg.setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    this.onGrab?.();
    this.onGhost?.(this.model.destination);
  };

  #move = (e: PointerEvent) => {
    if (this.#tapStart && Math.hypot(e.clientX - this.#tapStart.x, e.clientY - this.#tapStart.y) > TAP_SLOP_PX) this.#tapStart = null;
    if (!this.model.dragging) return;
    this.model.move(this.#toTable(e));
    this.onGhost?.(this.model.destination);
  };

  #up = (e: PointerEvent) => {
    const tap = this.#tapStart;
    this.#tapStart = null;
    if (tap && this.#shownReal && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= TAP_SLOP_PX) {
      this.model.tap(this.#toTable(e), this.#shownReal);
      this.onPreview?.(this.model.preview);
      return;
    }
    if (!this.model.dragging) return;
    const dest = this.model.up();
    this.onGhost?.(null);
    if (dest) {
      this.setTarget(dest);
      this.onRelease?.(dest);
    }
  };

  #cancel = () => {
    this.#tapStart = null;
    const had = this.model.preview !== null;
    this.model.cancel();
    this.onGhost?.(null);
    if (had) this.onPreview?.(null);
  };

  /** Um "Ir" saiu: o alvo fica na mesa até a máquina chegar. */
  setTarget(p: Point): void {
    if (this.#fadeTimer) clearTimeout(this.#fadeTimer);
    this.#fadeTimer = null;
    this.#target.classList.remove('arrived');
    this.model.setTarget(p, performance.now());
  }

  /** O "Ir" foi recusado ou a tela perdeu o controle: o alvo some. */
  clearTarget(): void {
    this.model.clearTarget();
  }

  #drawTarget(now: number, rx: number | null, ry: number | null, k: number): void {
    const xs = this.#bx.items;
    const ys = this.#by.items;
    const lx = xs[xs.length - 1]?.value;
    const ly = ys[ys.length - 1]?.value;
    const shown = this.model.target;
    if (shown && lx != null && ly != null) {
      const r = this.model.track({ x: lx, y: ly }, this.state, now);
      if (r === 'arrived') {
        // Esmaece no lugar e só então sai.
        this.#target.classList.add('arrived');
        this.#targetLine.style.display = 'none';
        this.#fadeTimer = setTimeout(() => {
          this.#target.style.display = 'none';
          this.#target.classList.remove('arrived');
          this.#fadeTimer = null;
        }, 260);
        return;
      }
    }
    const t = this.model.target;
    if (!t) {
      if (!this.#fadeTimer) this.#target.style.display = 'none';
      this.#targetLine.style.display = 'none';
      return;
    }
    this.#target.style.display = '';
    this.#target.setAttribute('transform', `translate(${t.x} ${-t.y}) scale(${12 * k})`);
    if (rx != null && ry != null) {
      this.#targetLine.style.display = '';
      this.#targetLine.setAttribute('x1', String(rx));
      this.#targetLine.setAttribute('y1', String(-ry));
      this.#targetLine.setAttribute('x2', String(t.x));
      this.#targetLine.setAttribute('y2', String(-t.y));
    }
  }

  #draw(now: number): void {
    const xs = this.#bx.items;
    const ys = this.#by.items;
    const rx = this.frozen ? xs[xs.length - 1]?.value : displayValue(xs, now, 120);
    const ry = this.frozen ? ys[ys.length - 1]?.value : displayValue(ys, now, 120);
    const k = Math.max(this.#mmPerPx().x, this.#mmPerPx().y);
    if (rx != null && ry != null) {
      this.#shownReal = { x: rx, y: ry };
      // A legenda fica do lado oposto ao ponto, para nunca ficar atrás dele.
      const low = ry < (this.#limits.y.min + this.#limits.y.max) / 2;
      if (low !== this.#pointLow) {
        this.#pointLow = low;
        this.#svg.parentElement?.parentElement?.classList.toggle('point-low', low);
      }
      for (const el of [this.#real, this.#halo]) {
        el.setAttribute('cx', String(rx));
        el.setAttribute('cy', String(-ry));
      }
      const zs = this.#bz.items;
      const rz = this.frozen ? zs[zs.length - 1]?.value : displayValue(zs, now, 120);
      const look = rz != null && this.zLimits ? zLook(rz, this.zLimits, this.zZero) : null;
      const scale = look?.scale ?? 1;
      this.#real.setAttribute('r', String(7 * k * scale));
      this.#halo.setAttribute('r', String((this.enabled ? 22 : 12 + 10 * (look?.softness ?? 0)) * k * scale));
      this.#halo.style.opacity = String(this.enabled ? 0.22 : 0.06 + 0.14 * (look?.softness ?? 0));
      this.#zring.setAttribute('cx', String(rx));
      this.#zring.setAttribute('cy', String(-ry));
      this.#zring.setAttribute('r', String(12 * k * scale));
      this.#zring.style.display = look?.atZero ? '' : 'none';
      const gauge = this.#gauge;
      if (gauge && look) {
        gauge.root.style.display = '';
        gauge.tool.style.transform = `translateY(${look.depth * gauge.h}px)`;
        gauge.zero.style.display = look.zeroDepth === null ? 'none' : '';
        if (look.zeroDepth !== null) gauge.zero.style.transform = `translateY(${look.zeroDepth * gauge.h}px)`;
        gauge.root.classList.toggle('at-zero', look.atZero);
      } else if (gauge) {
        gauge.root.style.display = 'none';
      }
    }
    this.#drawMotion(now, rx ?? null, ry ?? null, k);
    this.#drawTarget(now, rx ?? null, ry ?? null, k);
    const g = this.model.ghost ?? this.model.preview;
    if (g && rx != null && ry != null) {
      this.#ghost.style.display = '';
      this.#ghost.setAttribute('transform', `translate(${g.x} ${-g.y}) scale(${16 * k})`);
      this.#line.style.display = '';
      this.#line.setAttribute('x1', String(rx));
      this.#line.setAttribute('y1', String(-ry));
      this.#line.setAttribute('x2', String(g.x));
      this.#line.setAttribute('y2', String(-g.y));
    } else {
      this.#ghost.style.display = 'none';
      this.#line.style.display = 'none';
    }
  }

  /**
   * A velocidade real ao lado do ponto e um rastro curto atrás dele,
   * proporcional a ela. Nada previsto: é o FS: que a placa manda.
   */
  #drawMotion(now: number, rx: number | null, ry: number | null, k: number): void {
    const visible = rx !== null && ry !== null && !this.frozen && speedVisible(this.state, this.feed);
    this.#speed.classList.toggle('on', visible);
    if (rx === null || ry === null) return;
    this.#recent.push({ x: rx, y: ry, t: now });
    while (this.#recent.length > 2 && now - this.#recent[0]!.t > 120) this.#recent.shift();
    if (!visible) {
      this.#trail.style.display = 'none';
      return;
    }
    const text = speedText(this.feed);
    if (text !== this.#speedShown) this.#speed.textContent = this.#speedShown = text;
    // O rótulo fica ao lado do ponto, em px de tela, sem sair da mesa.
    const right = rx < (this.#limits.x.min + this.#limits.x.max) / 2;
    this.#speed.setAttribute('x', String(rx + (right ? 14 : -14) * k));
    this.#speed.setAttribute('y', String(-ry - 12 * k));
    this.#speed.setAttribute('text-anchor', right ? 'start' : 'end');
    this.#speed.style.fontSize = `${12 * k}px`;
    const dir = heading(this.#recent[0]!, { x: rx, y: ry });
    const len = trailPx(this.feed) * k;
    if (!dir || len <= 0) {
      this.#trail.style.display = 'none';
      return;
    }
    this.#trail.style.display = '';
    this.#trail.setAttribute('x1', String(rx));
    this.#trail.setAttribute('y1', String(-ry));
    this.#trail.setAttribute('x2', String(rx - dir.x * len));
    this.#trail.setAttribute('y2', String(-(ry - dir.y * len)));
  }
}

/** "X 410,00 · Y 220,00", nas coordenadas do DRO. */
export function destinationText(p: Point, offset: Point = { x: 0, y: 0 }): string {
  return `X ${formatMm(p.x - offset.x)} · Y ${formatMm(p.y - offset.y)}`;
}
