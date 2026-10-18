// De um pedido do navegador ao que vai para a placa. Puro: decide, não envia.
// Todo pedido passa pela policy (ADR-0005) e todo movimento vira um jog
// absoluto recortado pelo curso que a placa informou (ADR-0002, ADR-0008).

import {
  allowed,
  clampToLimits,
  leadForStep,
  formatJog,
  goTo,
  limitsOf,
  nudge,
  nudgeTo,
  type Axis,
  type AxisValues,
  type LinkMode,
  type MachineProfile,
  type MachineSnapshot,
} from '@rlight/core';
import { JOG_CANCEL, SOFT_RESET } from './board';
import type { CommandRequest } from './messages';

export interface MotionSettings {
  /** Avanço da régua. Limitado pelo máximo do eixo. */
  nudgeFeedMmPerMin: number;
  /** Ir até o fantasma: 2000 mm/min até o S2 dizer outra coisa (ADR-0002). */
  jogToFeedMmPerMin: number;
  maxLeadMm?: number;
}

// O fantasma e o destino da régua vão na velocidade máxima de cada eixo, lida da
// placa (ADR-0008): o destino é mostrado antes, o S2 aprovou, e um deslocamento
// longo deixa ver a rampa de aceleração do próprio planejador do FluidNC.
export const DEFAULT_MOTION: MotionSettings = { nudgeFeedMmPerMin: 1_000, jogToFeedMmPerMin: Infinity };

/** Sem velocidade máxima conhecida no eixo, um valor prudente. */
const FALLBACK_FEED_MM_PER_MIN = 2_000;

/**
 * Limite à frente e avanço da régua conforme o passo escolhido. Com só 2 mm à
 * frente no passo de 1 mm, cada jog terminava antes do próximo chegar e a
 * máquina andava aos trancos (visto no iPhone em 2026-10-17). Quatro passos à
 * frente, nunca menos que 2 mm; o avanço cresce com o passo e o eixo recorta.
 */
export function stepMotion(step: number): { leadMm: number; feedMmPerMin: number } {
  const leadMm = leadForStep(step);
  const feedMmPerMin = step <= 0.01 ? 300 : step <= 0.1 ? 1_000 : step <= 1 ? 2_000 : 3_000;
  return { leadMm, feedMmPerMin };
}

export interface CommandContext {
  snapshot: MachineSnapshot | null;
  profile: MachineProfile | null;
  link: LinkMode;
  inControl: boolean;
  homed: boolean;
  /** Alvo comandado; eixo ausente segue a posição reportada. */
  commanded: AxisValues;
  motion: MotionSettings;
  /** Relógio injetado, para o prazo do desfazer. */
  now: number;
  /** O último zero, para desfazer. */
  lastZero: ZeroMemory | null;
  /**
   * Uma linha do spindle (M3, S, M5) ainda na espera do spinup_ms/spindown_ms: a
   * placa não lê a próxima linha antes de ela acabar.
   */
  spindleDwelling?: boolean;
}

/** O offset anterior de cada eixo zerado, e quando o zero foi feito. */
export interface ZeroMemory {
  wco: AxisValues;
  at: number;
}

/** O desfazer do zero vale por esse tempo, e uma vez só. */
export const UNDO_ZERO_MS = 30_000;

export type BoardWrite = { line: string } | { realtime: number };

export type Plan =
  | {
      ok: true;
      writes: BoardWrite[];
      commanded: AxisValues;
      hitLimit: boolean;
      moves: boolean;
      undoable?: boolean;
      /** Ausente: a memória do zero fica como está. */
      lastZero?: ZeroMemory | null;
      /**
       * Uma troca de rotação durante a espera do spindle: não vai agora (ficaria na
       * fila), fica guardada e sai quando a espera acabar. Só a última conta.
       */
      deferredLine?: string;
    }
  | { ok: false; reason: string };

const refuse = (reason: string): Plan => ({ ok: false, reason });

function feedFor(profile: MachineProfile, axes: readonly Axis[], wanted: number): number {
  let feed = wanted;
  for (const axis of axes) {
    const max = profile.axes[axis]?.maxRateMmPerMin ?? 0;
    if (max > 0) feed = Math.min(feed, max);
  }
  return Number.isFinite(feed) ? feed : FALLBACK_FEED_MM_PER_MIN;
}

export function planCommand(req: CommandRequest, ctx: CommandContext): Plan {
  if (!ctx.snapshot) return refuse('Sem sinal da máquina');
  // Parar o que já parou deu certo: acontece ao soltar a régua no instante em que o movimento acaba.
  if (req.command === 'cancelJog' && ctx.snapshot.state === 'Idle' && ctx.link === 'live' && ctx.inControl) {
    return { ok: true, writes: [], commanded: {}, hitLimit: false, moves: false };
  }
  const decision = allowed(req.command, ctx.snapshot.state, {
    link: ctx.link,
    inControl: ctx.inControl,
    homed: ctx.homed,
  });
  if (!decision.ok) return refuse(decision.reason);

  const simple = (write: BoardWrite, resync: boolean): Extract<Plan, { ok: true }> => ({
    ok: true,
    writes: [write],
    commanded: resync ? {} : ctx.commanded,
    hitLimit: false,
    moves: false,
  });

  switch (req.command) {
    case 'unlock':
      return simple({ line: '$X' }, true);
    case 'home':
      return simple({ line: '$H' }, true);
    case 'softReset':
      return simple({ realtime: SOFT_RESET }, true);
    // Depois de parar, o alvo volta a ser a posição real.
    case 'cancelJog':
      return simple({ realtime: JOG_CANCEL }, true);
    case 'feedHold':
      return simple({ realtime: '!'.charCodeAt(0) }, false);
    case 'resume':
      return simple({ realtime: '~'.charCodeAt(0) }, false);
    case 'spindleOff':
      // Na espera do spin-up, um M5 ficaria na fila até ela acabar (5 s na RLight).
      // O reset de tempo real passa na frente e desliga o spindle na hora.
      if (ctx.spindleDwelling) return simple({ realtime: SOFT_RESET }, true);
      return simple({ line: 'M5' }, false);
    case 'zero': {
      const wco = ctx.snapshot.wco;
      if (!wco) return refuse('Ainda não sei o zero atual da peça; tente de novo em instantes');
      const axes: Axis[] = req.axis === 'all' ? ['x', 'y', 'z'] : [req.axis];
      const previous: AxisValues = {};
      for (const a of axes) previous[a] = wco[a];
      return {
        ...simple({ line: `G10 L20 P0 ${axes.map((a) => `${a.toUpperCase()}0`).join(' ')}` }, false),
        undoable: true,
        lastZero: { wco: previous, at: ctx.now },
      };
    }
    case 'undoZero': {
      const last = ctx.lastZero;
      if (!last || ctx.now - last.at > UNDO_ZERO_MS) return refuse('Nada para desfazer');
      const words = (Object.entries(last.wco) as [Axis, number][]).map(
        ([a, v]) => `${a.toUpperCase()}${(Object.is(v, -0) ? 0 : v).toFixed(3)}`,
      );
      return { ...simple({ line: `G10 L2 P0 ${words.join(' ')}` }, false), lastZero: null };
    }
    case 'spindleOn':
    case 'spindleSpeed': {
      if (!ctx.profile) return refuse('Lendo a configuração da máquina');
      const spindle = ctx.profile.spindle;
      if (!spindle) return refuse('Esta máquina não tem spindle configurado');
      let rpm = Math.round(req.rpm);
      // Puxar para 0 desliga: há máquinas (a de referência é uma) que seguem
      // girando na velocidade mínima do inversor com S0.
      if (rpm <= 0) {
        if (req.command === 'spindleOn') return refuse('Escolha uma rotação para ligar');
        return simple({ line: 'M5' }, false);
      }
      const floor = Math.max(spindle.minRunningRpm, spindle.minRpm, 1);
      const max = spindle.maxRpm > floor ? spindle.maxRpm : Infinity;
      const clamped = Math.min(Math.max(rpm, floor), max);
      const hitLimit = clamped !== rpm;
      rpm = clamped;
      const line = req.command === 'spindleOn' ? `M3 S${rpm}` : `S${rpm}`;
      // Trocar a rotação no meio da espera: guarda, e só a última troca sai no fim dela.
      if (req.command === 'spindleSpeed' && ctx.spindleDwelling) {
        return { ok: true, writes: [], commanded: ctx.commanded, hitLimit, moves: false, deferredLine: line };
      }
      return { ...simple({ line }, false), hitLimit };
    }
    case 'nudge':
    case 'jogTo':
    case 'jogAxisTo':
      break;
  }

  const { profile } = ctx;
  if (!profile) return refuse('Lendo a configuração da máquina');
  const mpos = ctx.snapshot.mpos;
  if (!mpos) return refuse('Posição desconhecida');
  const limits = limitsOf(profile);

  if (req.command === 'jogTo') {
    const { target, hitLimit } = goTo({ x: req.x, y: req.y }, limits);
    const feed = feedFor(profile, ['x', 'y'], ctx.motion.jogToFeedMmPerMin);
    return {
      ok: true,
      writes: [{ line: formatJog(target, feed) }],
      commanded: { ...ctx.commanded, ...target },
      hitLimit,
      moves: true,
    };
  }

  if (req.command === 'jogAxisTo') {
    // O destino foi mostrado antes (ADR-0010): só o curso recorta, sem o limite à frente.
    const { value, hitLimit } = clampToLimits(limits, req.axis, req.value);
    const feed = feedFor(profile, [req.axis], ctx.motion.jogToFeedMmPerMin);
    return {
      ok: true,
      writes: [{ line: formatJog({ [req.axis]: value }, feed) }],
      commanded: { ...ctx.commanded, [req.axis]: value },
      hitLimit,
      moves: true,
    };
  }

  const { axis, delta } = req;
  const scale = req.step === undefined ? null : stepMotion(req.step);
  const maxLeadMm = scale ? Math.max(scale.leadMm, ctx.motion.maxLeadMm ?? 0) : ctx.motion.maxLeadMm;
  const commanded = ctx.commanded[axis] ?? mpos[axis];
  const lead = maxLeadMm === undefined ? {} : { maxLeadMm };
  // Com `to`, o valor absoluto da régua, recortado pela folga em vez de recusado
  // (ADR-0002): a tela e o servidor nunca discordam do alvo. Sem `to`, o relativo antigo.
  const result =
    req.to !== undefined
      ? nudgeTo({ axis, to: req.to, commanded, reported: mpos[axis], limits, ...lead })
      : nudge({ axis, delta, commanded, reported: mpos[axis], limits, ...lead });
  if (result.refused === 'lead' && req.to === undefined) return refuse('A régua está à frente da máquina');
  const hitLimit = result.refused === 'limit';
  // Na parede: nada a mandar, mas o pedido foi entendido.
  if (result.target === commanded) {
    return { ok: true, writes: [], commanded: ctx.commanded, hitLimit, moves: false };
  }
  const feed = feedFor(profile, [axis], scale ? scale.feedMmPerMin : ctx.motion.nudgeFeedMmPerMin);
  return {
    ok: true,
    writes: [{ line: formatJog({ [axis]: result.target }, feed) }],
    commanded: { ...ctx.commanded, [axis]: result.target },
    hitLimit,
    moves: true,
  };
}
