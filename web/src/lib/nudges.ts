// A régua junta os traços de cada ~50 ms num único `nudge` (ADR-0002).
// Puro: quem chama passa o relógio e envia o que `flush` devolver.

import type { Axis } from '@rlight/core';

export const BATCH_MS = 50;

export class NudgeBatcher {
  #ticks = 0;
  #since: number | null = null;

  constructor(
    readonly axis: Axis,
    public step: number,
  ) {}

  add(ticks: number, now: number): void {
    if (ticks === 0) return;
    if (this.#since === null) this.#since = now;
    this.#ticks += ticks;
  }

  /** O comando a mandar agora, se a janela fechou e há algo a mandar. */
  flush(now: number, force = false): { command: 'nudge'; axis: Axis; delta: number } | null {
    if (this.#since === null) return null;
    if (!force && now - this.#since < BATCH_MS) return null;
    const ticks = this.#ticks;
    this.#ticks = 0;
    this.#since = null;
    if (ticks === 0) return null;
    return { command: 'nudge', axis: this.axis, delta: Math.round(ticks * this.step * 1e6) / 1e6 };
  }

  /** Um deslize ou um toque que segura: os traços pendentes viram o destino. */
  discard(): void {
    this.#ticks = 0;
    this.#since = null;
  }
}
