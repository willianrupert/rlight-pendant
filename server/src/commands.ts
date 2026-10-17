// De um pedido do navegador ao que vai para a placa. Puro: decide, não envia.
// Todo pedido passa pela policy (ADR-0005) e todo movimento vira um jog
// absoluto recortado pelo curso que a placa informou (ADR-0002, ADR-0008).

import {
  allowed,
  clampToLimits,
  formatJog,
  goTo,
  limitsOf,
  nudge,
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

export const DEFAULT_MOTION: MotionSettings = { nudgeFeedMmPerMin: 1_000, jogToFeedMmPerMin: 2_000 };

/**
 * Limite à frente e avanço da régua conforme o passo escolhido. Com só 2 mm à
 * frente no passo de 1 mm, cada jog terminava antes do próximo chegar e a
 * máquina andava aos trancos (visto no iPhone em 2026-10-17). Quatro passos à
 * frente, nunca menos que 2 mm; o avanço cresce com o passo e o eixo recorta.
 */
export function stepMotion(step: number): { leadMm: number; feedMmPerMin: number } {
  const leadMm = Math.max(2, 4 * step);
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
    }
  | { ok: false; reason: string };

const refuse = (reason: string): Plan => ({ ok: false, reason });

function feedFor(profile: MachineProfile, axes: readonly Axis[], wanted: number): number {
  let feed = wanted;
  for (const axis of axes) {
    const max = profile.axes[axis]?.maxRateMmPerMin ?? 0;
    if (max > 0) feed = Math.min(feed, max);
  }
  return feed;
}

export function planCommand(req: CommandRequest, ctx: CommandContext): Plan {
  if (!ctx.snapshot) return refuse('Sem sinal da máquina');
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
      const max = spindle.maxRpm > spindle.minRpm ? spindle.maxRpm : Infinity;
      const clamped = Math.min(Math.max(rpm, spindle.minRpm, 0), max);
      const hitLimit = clamped !== rpm;
      rpm = clamped;
      const line = req.command === 'spindleOn' ? `M3 S${rpm}` : `S${rpm}`;
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
  const result = nudge({
    axis,
    delta,
    commanded,
    reported: mpos[axis],
    limits,
    ...(maxLeadMm === undefined ? {} : { maxLeadMm }),
  });
  if (result.refused === 'lead') return refuse('A régua está à frente da máquina');
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
