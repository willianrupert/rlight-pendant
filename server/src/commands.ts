// De um pedido do navegador ao que vai para a placa. Puro: decide, não envia.
// Todo pedido passa pela policy (ADR-0005) e todo movimento vira um jog
// absoluto recortado pelo curso que a placa informou (ADR-0002, ADR-0008).

import {
  allowed,
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

export interface CommandContext {
  snapshot: MachineSnapshot | null;
  profile: MachineProfile | null;
  link: LinkMode;
  inControl: boolean;
  homed: boolean;
  /** Alvo comandado; eixo ausente segue a posição reportada. */
  commanded: AxisValues;
  motion: MotionSettings;
}

export type BoardWrite = { line: string } | { realtime: number };

export type Plan =
  | { ok: true; writes: BoardWrite[]; commanded: AxisValues; hitLimit: boolean; moves: boolean }
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

  const simple = (write: BoardWrite, resync: boolean): Plan => ({
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
    case 'nudge':
    case 'jogTo':
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

  const { axis, delta } = req;
  const commanded = ctx.commanded[axis] ?? mpos[axis];
  const result = nudge({
    axis,
    delta,
    commanded,
    reported: mpos[axis],
    limits,
    ...(ctx.motion.maxLeadMm === undefined ? {} : { maxLeadMm: ctx.motion.maxLeadMm }),
  });
  if (result.refused === 'lead') return refuse('A régua está à frente da máquina');
  const hitLimit = result.refused === 'limit';
  // Na parede: nada a mandar, mas o pedido foi entendido.
  if (result.target === commanded) {
    return { ok: true, writes: [], commanded: ctx.commanded, hitLimit, moves: false };
  }
  const feed = feedFor(profile, [axis], ctx.motion.nudgeFeedMmPerMin);
  return {
    ok: true,
    writes: [{ line: formatJog({ [axis]: result.target }, feed) }],
    commanded: { ...ctx.commanded, [axis]: result.target },
    hitLimit,
    moves: true,
  };
}
