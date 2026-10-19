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
  liftForTravel,
  nudge,
  nudgeTo,
  pointApproach,
  POINT_APPROACH_FEED,
  type Vec3,
  type Axis,
  type AxisValues,
  type LinkMode,
  type MachineProfile,
  type MachineSnapshot,
} from '@rlight/core';
import { JOG_CANCEL, SOFT_RESET } from './board';
import type { CommandRequest } from './messages';
import { ProbeSequence } from './probe';
import type { SavedPoint } from './points';

/** O "Desfazer" de um Ir vale por esse tempo. */
export const UNDO_MOVE_MS = 120_000;

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
  /** Os pontos salvos, para ir até um deles. */
  findPoint?: (id: string) => SavedPoint | null;
  /** Onde a máquina estava antes do último Ir ou ida a um ponto, e quando. */
  undoFrom?: { pos: Vec3; at: number } | null;
  /** Retomar: onde a máquina estava antes de perder o homing, se há oferta. */
  resumeTo?: Vec3 | null;
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
      /** A placa de toque começou: o gateway segue as fases pelos toques da placa. */
      probe?: ProbeSequence;
      /** Um movimento que se pode desfazer começou ('record'), ou o desfazer foi usado ('clear'). */
      undo?: 'record' | 'clear';
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
  // Salvar e apagar pontos não falam com a placa: o gateway cuida (precisa da lista).
  if (req.command === 'savePoint' || req.command === 'deletePoint' || req.command === 'dismissResume') return refuse('Pedido fora do lugar');
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
    case 'probeZ': {
      const profile = ctx.profile;
      if (!profile) return refuse('Lendo a configuração da máquina');
      if (!profile.hasProbe) return refuse('Esta máquina não tem apalpador configurado');
      const z = limitsOf(profile).z;
      const mpos = ctx.snapshot.mpos;
      const wco = ctx.snapshot.wco;
      if (!z || !mpos || !wco) return refuse('Ainda não sei a posição do Z; tente de novo em instantes');
      if (!(req.thicknessMm > 0 && req.thicknessMm <= 50)) return refuse('A espessura da placa precisa estar entre 0 e 50 mm');
      const probe = new ProbeSequence({ mposZ: mpos.z, wcoZ: wco.z, zMin: z.min, zMax: z.max, thicknessMm: req.thicknessMm });
      const step = probe.start();
      return { ok: true, writes: step.lines.map((line) => ({ line })), commanded: {}, hitLimit: false, moves: false, probe };
    }
    case 'nudge':
    case 'jogTo':
    case 'jogAxisTo':
    case 'goToPoint':
    case 'undoMove':
    case 'resumePosition':
      break;
  }

  const { profile } = ctx;
  if (!profile) return refuse('Lendo a configuração da máquina');
  const mpos = ctx.snapshot.mpos;
  if (!mpos) return refuse('Posição desconhecida');
  const limits = limitsOf(profile);

  const zFeed = feedFor(profile, ['z'], ctx.motion.jogToFeedMmPerMin);
  const xyFeed = feedFor(profile, ['x', 'y'], ctx.motion.jogToFeedMmPerMin);
  // Sem o offset da peça ainda, a superfície é tomada como o topo: sobe até lá.
  const wcoZ = ctx.snapshot.wco?.z ?? limits.z?.max ?? 0;
  const liftFrom = (z: number) => (limits.z ? liftForTravel({ mposZ: z, wcoZ, zMax: limits.z.max }) : null);

  if (req.command === 'jogTo') {
    const { target, hitLimit } = goTo({ x: req.x, y: req.y }, limits);
    // A fresa baixa sobe antes de atravessar a mesa (core/liftForTravel); os dois
    // jogs vão em sequência na fila da placa, e o Parar cancela os dois.
    const lift = liftFrom(mpos.z);
    const writes: BoardWrite[] = [];
    if (lift !== null) writes.push({ line: formatJog({ z: lift }, zFeed) });
    writes.push({ line: formatJog(target, xyFeed) });
    return {
      ok: true,
      writes,
      commanded: { ...ctx.commanded, ...target, ...(lift !== null ? { z: lift } : {}) },
      hitLimit,
      moves: true,
      undo: 'record',
    };
  }

  if (req.command === 'goToPoint' || req.command === 'resumePosition') {
    const p = req.command === 'goToPoint' ? ctx.findPoint?.(req.pointId) : ctx.resumeTo;
    if (!p) return refuse(req.command === 'goToPoint' ? 'Esse ponto não existe mais' : 'Não há para onde voltar');
    if (!limits.z) return refuse('O curso do Z ainda não é conhecido');
    const { target } = goTo({ x: p.x, y: p.y }, limits);
    const z = clampToLimits(limits, 'z', p.z).value;
    // O "Posicionar Job" do Romney: sobe ao topo, X e Y, rápido até 20 mm acima, devagar o resto.
    const a = pointApproach({ savedZ: z, zMax: limits.z.max });
    const writes: BoardWrite[] = [];
    if (mpos.z < a.top - 1e-6) writes.push({ line: formatJog({ z: a.top }, zFeed) });
    writes.push({ line: formatJog(target, xyFeed) });
    if (a.fastTo !== null) writes.push({ line: formatJog({ z: a.fastTo }, zFeed) });
    if (a.slowTo < (a.fastTo ?? a.top) - 1e-6) writes.push({ line: formatJog({ z: a.slowTo }, Math.min(zFeed, POINT_APPROACH_FEED)) });
    return { ok: true, writes, commanded: { ...ctx.commanded, ...target, z: a.slowTo }, hitLimit: false, moves: true, undo: 'record' };
  }

  if (req.command === 'undoMove') {
    const u = ctx.undoFrom;
    if (!u || ctx.now - u.at > UNDO_MOVE_MS) return refuse('Nada para desfazer');
    const { target } = goTo({ x: u.pos.x, y: u.pos.y }, limits);
    const z = limits.z ? clampToLimits(limits, 'z', u.pos.z).value : u.pos.z;
    const crosses = Math.hypot(target.x - mpos.x, target.y - mpos.y) > 0.5;
    const lift = crosses ? liftFrom(mpos.z) : null;
    const high = lift ?? mpos.z;
    const writes: BoardWrite[] = [];
    if (lift !== null) writes.push({ line: formatJog({ z: lift }, zFeed) });
    if (crosses) writes.push({ line: formatJog(target, xyFeed) });
    if (z < high - 1e-6) {
      // Descer de volta como na volta a um ponto: rápido até 20 mm acima, devagar o resto.
      const a = pointApproach({ savedZ: z, zMax: high });
      if (a.fastTo !== null) writes.push({ line: formatJog({ z: a.fastTo }, zFeed) });
      writes.push({ line: formatJog({ z }, Math.min(zFeed, POINT_APPROACH_FEED)) });
    } else if (z > high + 1e-6) {
      writes.push({ line: formatJog({ z }, zFeed) });
    }
    if (!writes.length) return { ok: true, writes, commanded: ctx.commanded, hitLimit: false, moves: false, undo: 'clear' };
    return { ok: true, writes, commanded: { ...ctx.commanded, ...target, z }, hitLimit: false, moves: true, undo: 'clear' };
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
