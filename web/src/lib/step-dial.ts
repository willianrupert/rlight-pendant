// O seletor de passo da régua: um mostrador horizontal, como o seletor do iOS.
// Mostra três valores (o escolhido no meio, os vizinhos menores dos lados) e
// troca deslizando ou tocando no vizinho. Lógica pura; a casca é ui/StepDial.

/**
 * Os passos oferecidos: o menor que a máquina faz de verdade (minStepMm do
 * perfil, ADR-0010) e quatro décadas acima dele: 0,01 · 0,1 · 1 · 10 · 100.
 */
export function stepLadder(minStep: number): number[] {
  return [1, 10, 100, 1_000, 10_000].map((k) => Math.round(minStep * k * 1e6) / 1e6);
}

/** O passo padrão: um acima do mínimo (0,1 mm), como na régua aprovada. */
export const DEFAULT_STEP_INDEX = 1;

/** Onde o mostrador para ao soltar: o índice mais próximo da posição arrastada. */
export function settleIndex(from: number, dragPx: number, cellPx: number, count: number): number {
  const pos = from - dragPx / Math.max(1, cellPx);
  return Math.min(count - 1, Math.max(0, Math.round(pos)));
}

/** Posição contínua durante o arrasto, com resistência além das pontas. */
export function dragPosition(from: number, dragPx: number, cellPx: number, count: number): number {
  const pos = from - dragPx / Math.max(1, cellPx);
  if (pos < 0) return pos * 0.35;
  if (pos > count - 1) return count - 1 + (pos - (count - 1)) * 0.35;
  return pos;
}

/** Tamanho e opacidade de cada valor pela distância ao centro. */
export function itemLook(distance: number): { scale: number; opacity: number } {
  const d = Math.min(2, Math.abs(distance));
  return { scale: 1 - 0.24 * Math.min(1, d), opacity: d >= 1.6 ? 0 : 1 - 0.45 * Math.min(1, d) - (d > 1 ? (d - 1) * 1.2 : 0) };
}

export function formatStep(step: number): string {
  return String(step).replace('.', ',');
}
