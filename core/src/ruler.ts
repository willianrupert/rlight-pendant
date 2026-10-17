// Física da régua de ajuste fino (ADR-0010). Funções puras: a interface só
// desenha o que estas funções decidem. Posições em "traços"; valor = traços × passo.

/** Constante de desaceleração, a mesma da rolagem normal do iOS. */
export const TAU_MS = 325;
/** Abaixo disto (traços por segundo), soltar o dedo assenta em vez de deslizar. */
export const FLICK_TICKS_PER_S = 6;
/** Fora do curso, o arrasto anda só esta fração. */
export const OVERSCROLL_RESISTANCE = 0.35;
/** Num deslize, a esta distância do destino o clique volta a ser em todo traço. */
export const FULL_CLICK_WITHIN_TICKS = 12;

export interface Sample {
  readonly t: number;
  readonly x: number;
}

/** Velocidade do dedo, em px por ms, medida na janela mais recente. */
export function velocityFromSamples(samples: readonly Sample[], windowMs = 100): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const recent = samples.filter((s) => last.t - s.t <= windowMs);
  const first = recent[0];
  if (!first || recent.length < 2 || last.t === first.t) return 0;
  return (last.x - first.x) / (last.t - first.t);
}

/** Quanto a régua anda para um movimento do dedo. Arrastar para a esquerda avança. */
export function dragDelta(input: {
  dxPx: number;
  pxPerTick: number;
  pos: number;
  minTick: number;
  maxTick: number;
}): number {
  const d = -input.dxPx / input.pxPerTick;
  const outside = input.pos < input.minTick || input.pos > input.maxTick;
  return outside ? d * OVERSCROLL_RESISTANCE : d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export type ReleasePlan = { kind: 'settle' | 'glide'; target: number };

/**
 * O que acontece ao soltar o dedo. O destino é decidido aqui, uma vez, e é para
 * ele que vai o único comando à placa (ADR-0002).
 */
export function planRelease(input: {
  pos: number;
  /** Traços por ms. */
  velocity: number;
  minTick: number;
  maxTick: number;
  tauMs?: number;
}): ReleasePlan {
  const tau = input.tauMs ?? TAU_MS;
  const { pos, velocity, minTick, maxTick } = input;
  if (pos < minTick || pos > maxTick) {
    return { kind: 'settle', target: clamp(Math.round(pos), minTick, maxTick) };
  }
  if (Math.abs(velocity) * 1000 > FLICK_TICKS_PER_S) {
    return { kind: 'glide', target: clamp(Math.round(pos + velocity * tau), minTick, maxTick) };
  }
  return { kind: 'settle', target: clamp(Math.round(pos), minTick, maxTick) };
}

/**
 * Posição durante o deslize. Uma exponencial que termina exatamente no destino
 * anunciado: a régua nunca para "pelo atrito" num ponto diferente.
 */
export function glidePosition(input: {
  from: number;
  target: number;
  elapsedMs: number;
  tauMs?: number;
  arriveWithin?: number;
}): number {
  const tau = input.tauMs ?? TAU_MS;
  const eps = input.arriveWithin ?? 0.02;
  const p = input.target - (input.target - input.from) * Math.exp(-input.elapsedMs / tau);
  return Math.abs(input.target - p) < eps ? input.target : p;
}

const LEGIBLE_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];

/**
 * O menor passo oferecido: o que a máquina realmente faz, nunca abaixo de
 * 0,01 mm, subindo até um valor legível. Oferecer menos que um passo do motor
 * seria mentir.
 */
export function minStepMm(stepsPerMm: number): number {
  if (!(stepsPerMm > 0) || !Number.isFinite(stepsPerMm)) {
    throw new RangeError(`Passos por mm inválidos: ${stepsPerMm}`);
  }
  const physical = 1 / stepsPerMm;
  const found = LEGIBLE_STEPS.find((s) => s >= physical - 1e-12);
  return found ?? LEGIBLE_STEPS[LEGIBLE_STEPS.length - 1]!;
}

/** As três pílulas de passo: o mínimo, dez e cem vezes ele. */
export function stepOptions(minStep: number): [number, number, number] {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return [r(minStep), r(minStep * 10), r(minStep * 100)];
}

/**
 * Qual clique um traço merece. No arrasto, todos; num deslize rápido, só os de
 * dez em dez, até chegar perto do destino.
 */
export function clickFor(input: {
  tick: number;
  gliding: boolean;
  ticksToTarget: number;
}): 'major' | 'minor' | null {
  const major = input.tick % 10 === 0;
  if (input.gliding && Math.abs(input.ticksToTarget) > FULL_CLICK_WITHIN_TICKS && !major) return null;
  return major ? 'major' : 'minor';
}
