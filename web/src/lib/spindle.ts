// A folha do spindle (VISION.md): um mostrador grande para escolher a rotação e
// segurar para ligar. O anel enche durante a confirmação e continua durante o
// spin-up do inversor, que é uma estimativa do perfil, não uma leitura.

export const DIAL_SWEEP_DEG = 270;
/** Valores comuns de fresas e inversores: o mostrador encosta neles ao soltar. */
export const COMMON_RPM = [6_000, 8_000, 10_000, 12_000, 15_000, 18_000, 20_000, 24_000];
const SNAP_RPM = 450;

export interface RpmRange {
  min: number;
  max: number;
}

export function rpmFromAngle(deg: number, r: RpmRange): number {
  const t = Math.min(1, Math.max(0, deg / DIAL_SWEEP_DEG));
  return Math.round((r.min + t * (r.max - r.min)) / 100) * 100;
}

export function angleFromRpm(rpm: number, r: RpmRange): number {
  if (r.max <= r.min) return 0;
  return (Math.min(r.max, Math.max(r.min, rpm)) - r.min) / (r.max - r.min) * DIAL_SWEEP_DEG;
}

/** Ao soltar, encosta num valor comum próximo, dentro da faixa. */
export function snapRpm(rpm: number, r: RpmRange): number {
  const near = COMMON_RPM.filter((c) => c >= r.min && c <= r.max).find((c) => Math.abs(c - rpm) <= SNAP_RPM);
  return near ?? Math.min(r.max, Math.max(r.min, Math.round(rpm / 100) * 100));
}

/** Um clique a cada mil rpm atravessados. */
export function thousandsCrossed(from: number, to: number): number {
  return Math.abs(Math.floor(to / 1000) - Math.floor(from / 1000));
}

/**
 * O ângulo do dedo em volta do centro, medido a partir do início do arco (o
 * mostrador começa embaixo à esquerda, a 225° do relógio, e anda no sentido horário).
 */
export function dialAngle(dx: number, dy: number): number {
  // 0° para cima, sentido horário.
  const clock = (Math.atan2(dx, -dy) * 180) / Math.PI;
  let a = clock + 135; // o início do arco, embaixo à esquerda, vira 0
  if (a < 0) a += 360;
  if (a > DIAL_SWEEP_DEG + (360 - DIAL_SWEEP_DEG) / 2) a -= 360; // o vão de baixo divide-se entre as pontas
  return a;
}

export interface Ring {
  /** 0 a 1, o quanto do anel está cheio. */
  fill: number;
  phase: 'idle' | 'confirming' | 'spinup' | 'running';
}

/**
 * O anel em duas partes: a confirmação de segurar ocupa o primeiro quarto, o
 * spin-up estimado o resto. Sem estimativa no perfil, a confirmação enche tudo.
 */
export function ringFill(input: { holdProgress: number; spinupStartedAt: number | null; now: number; spinupMs: number; running: boolean }): Ring {
  const share = input.spinupMs > 0 ? 0.25 : 1;
  if (input.spinupStartedAt !== null) {
    const t = input.spinupMs > 0 ? Math.min(1, (input.now - input.spinupStartedAt) / input.spinupMs) : 1;
    return { fill: share + (1 - share) * t, phase: t >= 1 ? 'running' : 'spinup' };
  }
  if (input.running) return { fill: 1, phase: 'running' };
  if (input.holdProgress > 0) return { fill: share * input.holdProgress, phase: 'confirming' };
  return { fill: 0, phase: 'idle' };
}
