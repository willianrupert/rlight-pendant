// Movimento manual por intenções completas (ADR-0002). Todo movimento é absoluto,
// em coordenadas de máquina, recortado pelo curso que a placa informa (ADR-0008).

export type Axis = 'x' | 'y' | 'z';
export const AXES: readonly Axis[] = ['x', 'y', 'z'];

export interface AxisLimits {
  readonly min: number;
  readonly max: number;
}

export type MachineLimits = Partial<Record<Axis, AxisLimits>>;
export type AxisValues = Partial<Record<Axis, number>>;

/** Avanço máximo do alvo da régua à frente da posição real. */
export const DEFAULT_MAX_LEAD_MM = 2;

/**
 * Quanto o alvo da régua pode ficar à frente da máquina, conforme o passo:
 * quatro passos, nunca menos que 2 mm. Servidor e app usam a mesma regra; o
 * app desenha esse alcance para que o que se vê na régua seja o que se alcança.
 */
export function leadForStep(step: number): number {
  return Math.max(DEFAULT_MAX_LEAD_MM, 4 * step);
}

/** Arredonda ao micrômetro, a precisão do comando enviado. */
export function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clampToLimits(
  limits: MachineLimits,
  axis: Axis,
  value: number,
): { value: number; hitLimit: boolean } {
  const l = limits[axis];
  if (!l) return { value, hitLimit: false };
  if (value < l.min) return { value: l.min, hitLimit: true };
  if (value > l.max) return { value: l.max, hitLimit: true };
  return { value, hitLimit: false };
}

export interface NudgeInput {
  axis: Axis;
  /** Distância pedida pela régua, em mm (já em múltiplos do passo). */
  delta: number;
  /** Alvo comandado atual. */
  commanded: number;
  /** Última posição reportada pela placa. */
  reported: number;
  limits: MachineLimits;
  maxLeadMm?: number;
}

export interface NudgeResult {
  target: number;
  /** Por que o pedido não foi atendido por inteiro, se não foi. */
  refused: 'limit' | 'lead' | null;
}

/**
 * A régua move o alvo comandado, nunca a posição reportada. Se o alvo ficaria
 * mais de `maxLeadMm` à frente da máquina, o passo é recusado: a régua "pesa".
 * Voltar em direção à máquina é sempre permitido.
 */
export function nudge(input: NudgeInput): NudgeResult {
  const maxLead = input.maxLeadMm ?? DEFAULT_MAX_LEAD_MM;
  const wanted = roundMm(input.commanded + input.delta);
  const clamped = clampToLimits(input.limits, input.axis, wanted);
  const target = roundMm(clamped.value);

  const leadNow = Math.abs(input.commanded - input.reported);
  const leadNext = Math.abs(target - input.reported);
  if (leadNext > maxLead + 1e-9 && leadNext > leadNow) {
    return { target: input.commanded, refused: 'lead' };
  }
  return { target, refused: clamped.hitLimit ? 'limit' : null };
}

export interface NudgeToInput {
  axis: Axis;
  /** O valor absoluto sob a linha da régua, em mm de máquina. */
  to: number;
  commanded: number;
  reported: number;
  limits: MachineLimits;
  maxLeadMm?: number;
}

/**
 * A régua manda o valor absoluto que mostra (ADR-0002), e o servidor recorta:
 * primeiro pelo curso, depois pela folga em volta da posição real. Recortar em vez
 * de recusar mantém a tela e o servidor de acordo sobre o alvo; um alvo já aceito
 * além da folga não é puxado para trás, só não avança até a máquina chegar perto.
 */
export function nudgeTo(input: NudgeToInput): NudgeResult {
  const maxLead = input.maxLeadMm ?? DEFAULT_MAX_LEAD_MM;
  const clamped = clampToLimits(input.limits, input.axis, input.to);
  const lo = Math.min(input.reported - maxLead, input.commanded);
  const hi = Math.max(input.reported + maxLead, input.commanded);
  const target = roundMm(Math.min(hi, Math.max(lo, clamped.value)));
  const refused = clamped.hitLimit ? 'limit' : target !== roundMm(clamped.value) ? 'lead' : null;
  return { target, refused };
}

/**
 * Quanto falta para chegar, em segundos, com a rampa da máquina: aceleração
 * constante até a velocidade máxima, cruzeiro e frenagem até parar (o trapézio
 * do planejador do Grbl/FluidNC). `speedMmPerMin` é a velocidade agora (o FS da
 * placa). Uma estimativa: as emendas entre trechos não entram, e o "Ir" é um só.
 */
export function remainingMoveSeconds(input: {
  distanceMm: number;
  speedMmPerMin: number;
  maxMmPerMin: number;
  accelMmPerS2: number;
}): number {
  const d = input.distanceMm;
  const a = input.accelMmPerS2;
  const vmax = input.maxMmPerMin / 60;
  if (d <= 0 || a <= 0 || vmax <= 0) return 0;
  const v0 = Math.min(vmax, Math.max(0, input.speedMmPerMin / 60));
  // Já não dá para acelerar: só a frenagem, que termina no destino.
  if (v0 > 0 && (v0 * v0) / (2 * a) >= d) return (2 * d) / v0;
  const vp = Math.min(vmax, Math.sqrt(a * d + (v0 * v0) / 2));
  const ramps = (2 * vp * vp - v0 * v0) / (2 * a);
  return (vp - v0) / a + vp / a + Math.max(0, d - ramps) / vmax;
}

/** O fantasma do mapa: um destino em X e Y, recortado pelo curso. */
export function goTo(
  point: { x: number; y: number },
  limits: MachineLimits,
): { target: { x: number; y: number }; hitLimit: boolean } {
  const x = clampToLimits(limits, 'x', point.x);
  const y = clampToLimits(limits, 'y', point.y);
  return { target: { x: roundMm(x.value), y: roundMm(y.value) }, hitLimit: x.hitLimit || y.hitLimit };
}

/**
 * Barreira no zero da peça. Um gesto que começou acima da superfície para nela;
 * para passar abaixo é preciso um gesto novo, de propósito, já na superfície.
 * Valores em coordenadas de trabalho.
 */
export function zBarrier(input: { startWorkZ: number; requestedWorkZ: number }): {
  workZ: number;
  stopped: boolean;
} {
  if (input.startWorkZ > 0 && input.requestedWorkZ < 0) return { workZ: 0, stopped: true };
  return { workZ: input.requestedWorkZ, stopped: false };
}

/**
 * O comando de jog que vai para a placa. Absoluto e em coordenadas de máquina,
 * então reenviar o mesmo texto por engano não move a máquina a mais.
 */
export function formatJog(target: AxisValues, feedMmPerMin: number): string {
  if (!(feedMmPerMin > 0) || !Number.isFinite(feedMmPerMin)) {
    throw new RangeError(`Avanço inválido: ${feedMmPerMin}`);
  }
  const words: string[] = [];
  for (const axis of AXES) {
    const v = target[axis];
    if (v === undefined) continue;
    if (!Number.isFinite(v)) throw new RangeError(`Destino inválido em ${axis}: ${v}`);
    const r = roundMm(v);
    words.push(`${axis.toUpperCase()}${(Object.is(r, -0) ? 0 : r).toFixed(3)}`);
  }
  if (words.length === 0) throw new RangeError('Jog sem nenhum eixo');
  return `$J=G53 G90 ${words.join(' ')} F${Math.round(feedMmPerMin)}`;
}

/** Ao voltar o sinal, o alvo comandado é reiniciado pela posição real (ADR-0007). */
export function resync(reported: AxisValues): AxisValues {
  return { ...reported };
}
