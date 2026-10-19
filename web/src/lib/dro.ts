// O caminho quente (ADR-0009): os números da posição. Fora do Svelte, um laço
// de requestAnimationFrame desenha cada eixo um relatório atrás, deslizando
// entre dois valores reais, e escreve direto no DOM. Nada é previsto.

import { ReportBuffer, displayValue, type Axis, type Vec3 } from '@rlight/core';

const SLOTS = 4; // dígitos inteiros: até 9999 mm
const STRIP = '0123456789';

/** Um número com dígitos que rolam sozinhos, como o numericText do iOS. */
export class DigitNumber {
  readonly #root: HTMLElement;
  readonly #sign: HTMLElement;
  readonly #strips: HTMLElement[] = [];
  #shown = '';

  constructor(root: HTMLElement) {
    this.#root = root;
    // Sem leitura ainda, um traço: os rolos em zero diriam "0000,00", uma posição que ninguém leu.
    root.classList.add('digits', 'empty');
    root.textContent = '';
    this.#sign = el('span', 'sign');
    root.append(this.#sign);
    for (let i = 0; i < SLOTS + 2; i++) {
      if (i === SLOTS) root.append(el('span', 'comma', ','));
      const slot = el('span', i >= SLOTS ? 'slot dec' : 'slot');
      const strip = el('span', 'strip');
      for (const c of STRIP) strip.append(el('span', '', c));
      strip.append(el('span', '', ' '));
      slot.append(strip);
      root.append(slot);
      this.#strips.push(strip);
    }
  }

  set(value: number): void {
    const r = Math.round(value * 100) / 100;
    const [i, d] = Math.abs(r).toFixed(2).split('.') as [string, string];
    const text = (r < 0 ? '−' : ' ') + i.padStart(SLOTS, ' ').slice(-SLOTS) + d;
    if (text === this.#shown) return;
    if (!this.#shown) this.#root.classList.remove('empty');
    this.#shown = text;
    this.#sign.textContent = r < 0 ? '−' : '';
    // O sinal encosta no primeiro dígito; a vírgula nunca sai do lugar.
    const leading = text.slice(1, SLOTS).match(/^ */)![0].length;
    this.#sign.style.transform = `translateX(${leading * 0.62}em)`;
    for (let k = 0; k < this.#strips.length; k++) {
      const c = text[k + 1]!;
      const idx = c === ' ' ? 10 : Number(c);
      this.#strips[k]!.style.transform = `translateY(${-idx * 1.1}em)`;
    }
  }
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const AXES: Axis[] = ['x', 'y', 'z'];

/** Recebe posições à medida que chegam e as desenha, liso, a cada quadro. */
export class Telemetry {
  readonly #buffers: Record<Axis, ReportBuffer> = { x: new ReportBuffer(), y: new ReportBuffer(), z: new ReportBuffer() };
  readonly #numbers: Partial<Record<Axis, { num: DigitNumber; root: HTMLElement }>> = {};
  readonly #arrivals: number[] = [];
  readonly #last: Partial<Record<Axis, { v: number; t: number }>> = {};
  #raf = 0;
  #frozen = false;

  attach(axis: Axis, root: HTMLElement): void {
    this.#numbers[axis] = { num: new DigitNumber(root), root };
  }

  push(pos: Vec3, at: number): void {
    this.#arrivals.push(at);
    if (this.#arrivals.length > 12) this.#arrivals.shift();
    for (const a of AXES) this.#buffers[a].push({ at, value: pos[a] });
  }

  /** Sem sinal: congela no último valor real (ADR-0007). */
  freeze(frozen: boolean): void {
    this.#frozen = frozen;
  }

  /** Numa reconexão, o passado não serve para interpolar o presente. */
  clear(): void {
    for (const a of AXES) this.#buffers[a].clear();
  }

  start(): void {
    const frame = (now: number) => {
      this.#draw(now);
      this.#raf = requestAnimationFrame(frame);
    };
    this.#raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.#raf);
  }

  /** Um intervalo de relatório de atraso, medido, entre 80 e 300 ms. */
  #delay(): number {
    const a = this.#arrivals;
    if (a.length < 3) return 150;
    const gaps = a.slice(1).map((t, i) => t - a[i]!).sort((p, q) => p - q);
    return Math.min(300, Math.max(80, gaps[Math.floor(gaps.length / 2)]!));
  }

  #draw(now: number): void {
    const delay = this.#delay();
    for (const a of AXES) {
      const n = this.#numbers[a];
      if (!n) continue;
      const items = this.#buffers[a].items;
      const v = this.#frozen ? items[items.length - 1]?.value : displayValue(items, now, delay);
      if (v == null) continue;
      // Rápido demais para o olho acompanhar: os dígitos trocam sem rolar.
      const prev = this.#last[a];
      const speed = prev ? Math.abs(v - prev.v) / Math.max(1, now - prev.t) : 0; // mm/ms
      this.#last[a] = { v, t: now };
      n.root.classList.toggle('fast', speed > 0.004);
      n.num.set(v);
    }
  }
}
