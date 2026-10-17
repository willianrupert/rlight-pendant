// O mapa da mesa, visto de cima, com o fantasma (ADR-0002). Arrastar o fantasma
// não move a máquina; soltar manda um único `jogTo`. O modelo do gesto é puro;
// o desenho escreve direto em atributos do SVG num laço de rAF, fora do Svelte.

import { ReportBuffer, displayValue, goTo, type AxisLimits } from '@rlight/core';
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
export class GhostModel {
  limits: TableLimits;
  dragging = false;
  /** Onde o fantasma está desenhado (com o elástico fora da mesa). */
  ghost: Point | null = null;
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
  }
}

const NS = 'http://www.w3.org/2000/svg';

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
  readonly #bx = new ReportBuffer();
  readonly #by = new ReportBuffer();
  #limits: TableLimits;
  #raf = 0;
  #shownReal: Point | null = null;
  model: GhostModel;
  /** Pode arrastar (com controle, com sinal, com homing, em repouso). */
  enabled = false;
  frozen = false;
  onGhost: ((dest: Point | null) => void) | null = null;
  onRelease: ((dest: Point) => void) | null = null;
  onGrab: (() => void) | null = null;

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
    svg.append(grid, this.#line, this.#halo, this.#real, this.#ghost);
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
    this.#svg.setAttribute('viewBox', `${x.min} ${-y.max} ${w} ${h}`);
    const grid = this.#svg.querySelector('.grid')!;
    grid.textContent = '';
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

  push(p: Point, at: number): void {
    this.#bx.push({ at, value: p.x });
    this.#by.push({ at, value: p.y });
  }

  clear(): void {
    this.#bx.clear();
    this.#by.clear();
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
    this.#svg.removeEventListener('pointerdown', this.#down);
    this.#svg.removeEventListener('pointermove', this.#move);
    this.#svg.removeEventListener('pointerup', this.#up);
    this.#svg.removeEventListener('pointercancel', this.#cancel);
  }

  /** Quantos mm de mesa cabem num px de tela (os eixos têm escalas próprias). */
  #mmPerPx(): Point {
    const r = this.#svg.getBoundingClientRect();
    const { x, y } = this.#limits;
    return { x: (x.max - x.min) / Math.max(1, r.width), y: (y.max - y.min) / Math.max(1, r.height) };
  }

  #toTable(e: PointerEvent): Point {
    const r = this.#svg.getBoundingClientRect();
    const { x, y } = this.#limits;
    return {
      x: x.min + ((e.clientX - r.left) / Math.max(1, r.width)) * (x.max - x.min),
      y: y.max - ((e.clientY - r.top) / Math.max(1, r.height)) * (y.max - y.min),
    };
  }

  #down = (e: PointerEvent) => {
    if (!this.enabled || !this.#shownReal) return;
    const k = this.#mmPerPx();
    // Raio de pega de 40 px de tela, para o polegar de luva.
    const radius = 40 * Math.max(k.x, k.y);
    if (!this.model.down(this.#toTable(e), this.#shownReal, radius)) return;
    try {
      this.#svg.setPointerCapture(e.pointerId);
    } catch {
      /* o ponteiro já saiu */
    }
    this.onGrab?.();
    this.onGhost?.(this.model.destination);
  };

  #move = (e: PointerEvent) => {
    if (!this.model.dragging) return;
    this.model.move(this.#toTable(e));
    this.onGhost?.(this.model.destination);
  };

  #up = () => {
    if (!this.model.dragging) return;
    const dest = this.model.up();
    this.onGhost?.(null);
    if (dest) this.onRelease?.(dest);
  };

  #cancel = () => {
    this.model.cancel();
    this.onGhost?.(null);
  };

  #draw(now: number): void {
    const xs = this.#bx.items;
    const ys = this.#by.items;
    const rx = this.frozen ? xs[xs.length - 1]?.value : displayValue(xs, now, 120);
    const ry = this.frozen ? ys[ys.length - 1]?.value : displayValue(ys, now, 120);
    const k = Math.max(this.#mmPerPx().x, this.#mmPerPx().y);
    if (rx != null && ry != null) {
      this.#shownReal = { x: rx, y: ry };
      for (const el of [this.#real, this.#halo]) {
        el.setAttribute('cx', String(rx));
        el.setAttribute('cy', String(-ry));
      }
      this.#real.setAttribute('r', String(7 * k));
      this.#halo.setAttribute('r', String(this.enabled ? 22 * k : 0));
    }
    const g = this.model.ghost;
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
}

/** "X 410,00 · Y 220,00", nas coordenadas do DRO. */
export function destinationText(p: Point, offset: Point = { x: 0, y: 0 }): string {
  return `X ${formatMm(p.x - offset.x)} · Y ${formatMm(p.y - offset.y)}`;
}
