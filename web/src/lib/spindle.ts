// A folha do spindle (VISION.md): um mostrador grande para escolher a rotação e
// segurar para ligar. O anel enche durante a confirmação e continua durante o
// spin-up do inversor, que é uma estimativa do perfil, não uma leitura.

import { formatRpm } from './present';

export const DIAL_SWEEP_DEG = 270;
/** Valores comuns de fresas e inversores: o mostrador encosta neles ao soltar. */
export const COMMON_RPM = [6_000, 8_000, 10_000, 12_000, 15_000, 18_000, 20_000, 24_000];
const SNAP_RPM = 450;

export interface RpmRange {
  min: number;
  max: number;
}

/**
 * O começo do arco é a parada "Desligado": abaixo da menor rotação que o
 * mostrador oferece (minRunningRpm do perfil) não existe "devagar", existe
 * desligado. Rotação 0 aqui significa desligado.
 */
export const OFF_DEG = 30;
export const OFF = 0;

export function rpmFromAngle(deg: number, r: RpmRange): number {
  if (deg < OFF_DEG / 2) return OFF;
  const t = Math.min(1, Math.max(0, (deg - OFF_DEG) / (DIAL_SWEEP_DEG - OFF_DEG)));
  return Math.round((r.min + t * (r.max - r.min)) / 100) * 100;
}

export function angleFromRpm(rpm: number, r: RpmRange): number {
  if (rpm <= OFF) return 0;
  if (r.max <= r.min) return OFF_DEG;
  return OFF_DEG + ((Math.min(r.max, Math.max(r.min, rpm)) - r.min) / (r.max - r.min)) * (DIAL_SWEEP_DEG - OFF_DEG);
}

/** Ao soltar, encosta num valor comum próximo, dentro da faixa; o desligado fica desligado. */
export function snapRpm(rpm: number, r: RpmRange): number {
  if (rpm <= OFF) return OFF;
  const near = COMMON_RPM.filter((c) => c >= r.min && c <= r.max).find((c) => Math.abs(c - rpm) <= SNAP_RPM);
  return near ?? Math.min(r.max, Math.max(r.min, Math.round(rpm / 100) * 100));
}

/** Um clique a cada mil rpm atravessados (e ao entrar ou sair do desligado). */
export function thousandsCrossed(from: number, to: number): number {
  if ((from <= OFF) !== (to <= OFF)) return 1;
  return Math.abs(Math.floor(to / 1000) - Math.floor(from / 1000));
}

/** O que soltar o mostrador faz: com o spindle ligado, ajusta ou (no desligado) desliga. */
export function releaseAction(input: { rpm: number; on: boolean; canAdjust: boolean; canStop: boolean }):
  | { command: 'spindleOff' }
  | { command: 'spindleSpeed'; rpm: number }
  | null {
  if (!input.on) return null;
  if (input.rpm <= OFF) return input.canStop ? { command: 'spindleOff' } : null;
  return input.canAdjust ? { command: 'spindleSpeed', rpm: input.rpm } : null;
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

/**
 * Quanto o inversor leva até uma rotação, partindo do repouso. A rampa dele é de
 * aceleração constante e o perfil diz o tempo de 0 ao máximo (spinup_ms), então
 * rotações baixas chegam antes.
 */
export function rampMs(targetRpm: number, maxRpm: number, spinupMs: number): number {
  if (spinupMs <= 0 || maxRpm <= 0) return 0;
  return spinupMs * Math.min(1, Math.max(0, targetRpm) / maxRpm);
}

/** O ângulo do anel para uma rotação; abaixo da faixa, ele cresce dentro do trecho do desligado. */
function ringAngle(rpm: number, r: RpmRange): number {
  if (rpm <= 0) return 0;
  if (rpm < r.min) return (OFF_DEG * rpm) / r.min;
  return angleFromRpm(rpm, r);
}

export interface Ring {
  /** 0 a 1, o quanto do arco está cheio. */
  fill: number;
  phase: 'idle' | 'confirming' | 'spinup' | 'running';
  /** Durante a aceleração: a rotação estimada pela rampa. É estimativa, não leitura. */
  estimatedRpm: number;
}

/**
 * O anel é a rotação: segurar enche o trecho do desligado; depois ele sobe pela
 * rampa do inversor até a rotação escolhida e, girando, mostra a reportada.
 */
export function ringFill(input: {
  holdProgress: number;
  spinupStartedAt: number | null;
  now: number;
  spinupMs: number;
  maxRpm: number;
  targetRpm: number;
  range: RpmRange;
  running: boolean;
  runningRpm: number;
}): Ring {
  const frac = (rpm: number) => ringAngle(rpm, input.range) / DIAL_SWEEP_DEG;
  if (input.spinupStartedAt !== null) {
    const elapsed = Math.max(0, input.now - input.spinupStartedAt);
    const est = input.spinupMs > 0 && input.maxRpm > 0 ? Math.min(input.targetRpm, (input.maxRpm / input.spinupMs) * elapsed) : input.targetRpm;
    const done = est >= input.targetRpm;
    return { fill: frac(est), phase: done ? 'running' : 'spinup', estimatedRpm: Math.round(est / 100) * 100 };
  }
  if (input.running) return { fill: frac(input.runningRpm > 0 ? input.runningRpm : input.targetRpm), phase: 'running', estimatedRpm: 0 };
  if (input.holdProgress > 0) return { fill: (OFF_DEG / DIAL_SWEEP_DEG) * input.holdProgress, phase: 'confirming', estimatedRpm: 0 };
  return { fill: 0, phase: 'idle', estimatedRpm: 0 };
}

/**
 * A linha de estado sob a rotação. Entre o fim da rampa estimada e a placa
 * confirmar (o campo A: chega a cada ~10 relatórios), diz "Ligando…": nem
 * "Ligado", que a placa ainda não disse, nem "Parado", com o motor girando.
 */
export function spindleStatus(input: {
  phase: Ring['phase'];
  estimatedRpm: number;
  on: boolean;
  started: boolean;
  reported: number;
  /** Uma troca de rotação pedida que a placa ainda não reportou. */
  adjustingTo?: number | null;
}): string {
  if (input.on && input.adjustingTo != null && input.reported !== input.adjustingTo) {
    return `Ajustando · ${formatRpm(input.reported)} → ${formatRpm(input.adjustingTo)} rpm`;
  }
  if (input.on) return input.reported > 0 ? `Ligado · ${formatRpm(input.reported)} rpm` : 'Ligado';
  if (input.phase === 'spinup') return `Acelerando · ~${formatRpm(input.estimatedRpm)} rpm`;
  if (input.started) return 'Ligando…';
  return 'Parado';
}

/**
 * A estimativa do arranque deixa de valer quando a placa confirma que está ligado
 * e a rampa estimada acabou, ou quando a rotação mudou no meio: daí o anel segue a
 * rotação que a placa reporta.
 */
export function spinupOver(input: { running: boolean; phase: Ring['phase']; target: number; spinupTarget: number | null }): boolean {
  if (!input.running) return false;
  return input.phase === 'running' || input.target !== input.spinupTarget;
}

export interface SpindleButtons {
  /** Segurar para ligar: só com o spindle parado segundo a placa. */
  start: boolean;
  /**
   * Desligar existe sempre: mandar M5 nunca faz mal, e o motor pode estar girando
   * com a placa dizendo que não (visto na máquina real, a 30 Hz com 0 rpm
   * reportado). Em destaque quando a placa diz que gira; discreto quando não.
   */
  stop: 'primary' | 'secondary';
  /** Uma linha honesta quando a placa não manda girar. */
  idleNote: string | null;
}

/**
 * "Ligado" é o que a placa diz (`spindleOn`, do campo A: do relatório), nunca
 * rotação > 0: com S0 e M3 ativo o inversor segue girando no mínimo e a placa
 * reporta 0 rpm.
 */
export function spindleButtons(input: { on: boolean; spinningUp: boolean; pending: string | null; holding?: boolean }): SpindleButtons {
  // Com o dedo ainda no ligar, o layout congela: senão o Desligar cresce para debaixo
  // do dedo e soltar vira um toque nele.
  if (input.holding) return { start: true, stop: 'secondary', idleNote: null };
  const running = input.on || input.spinningUp;
  return {
    start: !running,
    stop: running ? 'primary' : 'secondary',
    idleNote: !running && !input.pending ? 'A placa não está mandando o spindle girar.' : null,
  };
}
