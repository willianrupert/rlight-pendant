// Como o movimento real aparece, sem inventar nada: a velocidade é a que a placa
// reporta (`FS:` do FluidNC, a rampa do planejador dela), o rastro é proporcional
// a ela e as paredes são o curso que a placa informa (ADR-0008).

import type { AxisLimits, MachineState } from '@rlight/core';
import { formatFeed } from './present';

const MOVING: readonly MachineState[] = ['Jog', 'Run', 'Home'];

/** A velocidade aparece só com a máquina andando de verdade. */
export function speedVisible(state: MachineState | null, feedMmPerMin: number): boolean {
  return state !== null && MOVING.includes(state) && feedMmPerMin > 0;
}

/** "2.940 mm/min" */
export function speedText(feedMmPerMin: number): string {
  return `${formatFeed(feedMmPerMin)} mm/min`;
}

/** Comprimento do rastro, em px: proporcional à velocidade, até um teto. */
export function trailPx(feedMmPerMin: number, maxFeed = 3_000, maxPx = 34): number {
  if (!(feedMmPerMin > 0) || !(maxFeed > 0)) return 0;
  return Math.min(1, feedMmPerMin / maxFeed) * maxPx;
}

/** A direção do movimento entre dois quadros, ou null se quase não andou. */
export function heading(prev: { x: number; y: number }, cur: { x: number; y: number }, minMm = 0.01): { x: number; y: number } | null {
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  const d = Math.hypot(dx, dy);
  return d < minMm ? null : { x: dx / d, y: dy / d };
}

export interface Wall {
  value: number;
  kind: 'limit' | 'zero';
}

/**
 * As paredes da régua de um eixo: início e fim do curso (todos os eixos) e, no
 * Z, a superfície da peça.
 */
export function wallsFor(limits: AxisLimits | null, workZero: number | null): Wall[] {
  const walls: Wall[] = [];
  if (limits) walls.push({ value: limits.min, kind: 'limit' }, { value: limits.max, kind: 'limit' });
  if (workZero !== null && (!limits || (workZero > limits.min && workZero < limits.max))) walls.push({ value: workZero, kind: 'zero' });
  return walls;
}
