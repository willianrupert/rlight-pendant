// A geometria da régua: o que se vê nela é o que se alcança. Funções puras; o
// desenho (ruler-view.ts) e o gesto só aplicam o que elas decidem.

import { leadForStep, type AxisLimits } from '@rlight/core';

/** O espaço entre traços nos passos finos, como na régua aprovada (ADR-0010). */
export const BASE_PX_PER_TICK = 22;

/**
 * O espaço entre traços. Nos passos grandes o alcance (poucos traços à frente da
 * máquina) preenche meia régua: nunca sobra uma fileira de traços que o dedo vê
 * e não consegue usar. Nos passos finos nada muda.
 */
export function pxPerTick(step: number, halfWidthPx: number): number {
  const ticksOfReach = leadForStep(step) / step;
  return Math.max(BASE_PX_PER_TICK, halfWidthPx / ticksOfReach);
}

/**
 * Até onde a régua pode ir agora, em coordenada de máquina: a posição real mais
 * ou menos o alcance do passo, dentro do curso. Anda junto com a máquina.
 */
export function reachOf(reported: number, step: number, limits: AxisLimits | null): { lo: number; hi: number } {
  const lead = leadForStep(step);
  const lo = reported - lead;
  const hi = reported + lead;
  return limits ? { lo: Math.max(limits.min, lo), hi: Math.min(limits.max, hi) } : { lo, hi };
}

/** Um traço fora do alcance (ou do curso) aparece apagado. */
export function tickReachable(value: number, reach: { lo: number; hi: number } | null): boolean {
  if (!reach) return true;
  return value >= reach.lo - 1e-6 && value <= reach.hi + 1e-6;
}

/**
 * A faixa entre o alvo (a linha azul, no centro) e a máquina (o marcador branco):
 * o que ainda falta andar. Em px a partir do centro; null quando já chegou.
 */
export function travelBand(input: { target: number; machine: number; step: number; spacing: number }): { from: number; to: number } | null {
  const dx = ((input.machine - input.target) / input.step) * input.spacing;
  if (Math.abs(dx) < 1) return null;
  return { from: Math.min(0, dx), to: Math.max(0, dx) };
}

/** De quantos em quantos traços vai um número, para os números nunca se encostarem. */
export function labelEvery(spacing: number, minGapPx = 64): number {
  return [1, 2, 5, 10].find((n) => n * spacing >= minGapPx) ?? 10;
}

/** A mola que leva o espaçamento de um passo ao outro: chega sem pular. */
export function approach(current: number, target: number, dtMs: number, tauMs = 90): number {
  const next = target + (current - target) * Math.exp(-dtMs / tauMs);
  return Math.abs(next - target) < 0.05 ? target : next;
}
