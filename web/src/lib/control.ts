// O que a tela oferece e como ela sabe que um comando valeu (ADR-0005). A
// policy é a do core, a mesma do servidor: a tela só pergunta e esconde o resto.
// Nada aqui toca o DOM.

import { allowed, type Command, type MachineSnapshot, type MachineState, type PolicyContext } from '@rlight/core';
import type { CommandName, CommandResult } from './connection';
import { alarmAction } from './present';

/** Os controles só existem com sinal e com o controle nas mãos (ADR-0007). */
export function controlsVisible(input: { live: boolean; inControl: boolean; hasMachine: boolean }): boolean {
  return input.live && input.inControl && input.hasMachine;
}

/** "Assumir o controle" aparece com sinal, quando esta tela ainda não comanda. */
export function canTakeControl(input: { live: boolean; inControl: boolean; hasMachine: boolean }): boolean {
  return input.live && input.hasMachine && !input.inControl;
}

export type ActionCommand = Extract<Command, 'unlock' | 'home' | 'feedHold' | 'resume' | 'softReset' | 'cancelJog'>;

export interface ActionSlot {
  kind: 'action';
  command: ActionCommand;
  label: string;
  /** O perigoso se confirma segurando. */
  hold: boolean;
  tone: 'primary' | 'normal' | 'danger' | 'quiet';
}

/** Um lugar fixo na barra de ações. Vazio continua ocupando o lugar. */
export type Slot = ActionSlot | { kind: 'spindle' } | { kind: 'zeroAll' } | null;

const LABELS: Record<ActionCommand, string> = {
  unlock: 'Desbloquear',
  home: 'Homing',
  feedHold: 'Pausar',
  resume: 'Retomar',
  softReset: 'Resetar',
  cancelJog: 'Parar',
};

const HOLD = new Set<ActionCommand>(['home', 'softReset']);

type Want = ActionCommand | 'spindle' | 'zeroAll' | null;

// Três lugares fixos: à esquerda o spindle (ou o homing, no alarme), no meio a
// ação do estado, à direita o perigoso ou o raro. Nada muda de lugar quando o
// estado muda; o conteúdo troca dentro do mesmo lugar (DESIGN.md: uma coisa por
// vez, sem a tela pular). Sem o estado pedir, o lugar fica vazio.
const LAYOUT: Record<MachineState, [Want, Want, Want]> = {
  Idle: ['spindle', 'home', 'zeroAll'],
  Jog: ['spindle', 'cancelJog', null],
  Run: ['spindle', 'feedHold', 'softReset'],
  Hold: ['spindle', 'resume', 'softReset'],
  Alarm: ['home', 'unlock', 'softReset'],
  Home: [null, 'softReset', null],
  Door: [null, 'softReset', null],
  Check: [null, 'softReset', null],
  Sleep: [null, 'softReset', null],
};

/** O que cada um dos três lugares mostra neste estado; a policy do core filtra. */
export function barSlots(
  state: MachineState,
  ctx: PolicyContext & { canHome: boolean; hasSpindle: boolean },
): [Slot, Slot, Slot] {
  const slot = (want: Want, i: number): Slot => {
    if (want === null) return null;
    if (want === 'spindle') return ctx.hasSpindle ? { kind: 'spindle' } : null;
    if (want === 'zeroAll') return allowed('zero', state, ctx).ok ? { kind: 'zeroAll' } : null;
    if (!allowed(want, state, ctx).ok) return null;
    if (want === 'home' && !ctx.canHome) return null;
    // No meio fica a ação principal; em repouso, o homing só é principal quando ainda falta.
    // No alarme, o destaque vai para o que resolve (alarmAction): homing se a
    // posição se perdeu, desbloquear se não. Os lugares não mudam.
    const primary =
      state === 'Alarm'
        ? want === alarmAction(ctx.homed)
        : i === 1 && want !== 'softReset' && !(state === 'Idle' && ctx.homed);
    const tone = want === 'softReset' ? 'danger' : primary ? 'primary' : 'normal';
    return { kind: 'action', command: want, label: LABELS[want], hold: HOLD.has(want), tone };
  };
  if (state === 'Alarm') return alarmSlots(ctx);
  const [a, b, c] = LAYOUT[state];
  return [slot(a, 0), slot(b, 1), slot(c, 2)];
}

/**
 * No alarme, uma ação principal no meio: o homing se a posição se perdeu, o
 * desbloquear se não. Desbloquear sem homing (para se afastar de um fim de curso,
 * por exemplo) fica discreto ao lado. O Resetar não aparece: um reset não limpa o
 * alarme, e três botões lado a lado confundiam (visto no iPhone).
 */
function alarmSlots(ctx: PolicyContext & { canHome: boolean }): [Slot, Slot, Slot] {
  const action = (command: ActionCommand, tone: ActionSlot['tone'], hold: boolean): Slot =>
    allowed(command, 'Alarm', ctx).ok ? { kind: 'action', command, label: LABELS[command], hold, tone } : null;
  if (alarmAction(ctx.homed) === 'home' && ctx.canHome) {
    return [null, action('home', 'primary', true), action('unlock', 'quiet', false)];
  }
  return [null, action('unlock', 'primary', false), null];
}

/** O que o comando muda e por isso confirma quando o estado novo chega. */
export function confirmedBy(
  command: CommandName,
  _before: MachineState | null,
  now: MachineSnapshot,
  homing: { before: boolean; now: boolean } = { before: false, now: false },
): boolean {
  switch (command) {
    case 'unlock':
      return now.state !== 'Alarm';
    case 'home':
      // Um homing rápido pode acabar entre dois relatórios: "agora tem homing" também confirma.
      return now.state === 'Home' || (!homing.before && homing.now);
    case 'feedHold':
      return now.state === 'Hold';
    case 'resume':
      return now.state !== 'Hold';
    case 'softReset':
      return true;
    case 'cancelJog':
      return now.state !== 'Jog';
    // Ligado é o que a placa diz (campo A:), não a rotação reportada.
    case 'spindleOn':
      return now.spindleOn;
    case 'spindleOff':
      return !now.spindleOn;
    default:
      return true;
  }
}

export const CONFIRM_TIMEOUT_MS = 5_000;

export type PendingPhase = 'sent' | 'accepted';

export interface Pending {
  id: string;
  command: CommandName;
  phase: PendingPhase;
  sentAt: number;
  before: MachineState | null;
  homedBefore: boolean;
}

export type Outcome = { kind: 'confirmed'; command: CommandName } | { kind: 'failed'; command: CommandName; reason: string };

/**
 * Um comando enviado fica pendente até a máquina confirmar (DESIGN.md: a tela
 * nunca mente). O `result` diz que o servidor aceitou; o `state` diz que a
 * máquina fez.
 */
export class PendingTracker {
  #items: Pending[] = [];

  get items(): readonly Pending[] {
    return this.#items;
  }

  /** Há um comando deste tipo ainda sem confirmação? */
  has(command: CommandName): boolean {
    return this.#items.some((p) => p.command === command);
  }

  sent(id: string, command: CommandName, now: number, before: MachineState | null, homedBefore = false): void {
    this.#items.push({ id, command, phase: 'sent', sentAt: now, before, homedBefore });
  }

  result(id: string, result: CommandResult): Outcome | null {
    const p = this.#items.find((i) => i.id === id);
    if (!p) return null;
    if (!result.ok) {
      this.#remove(p);
      return { kind: 'failed', command: p.command, reason: result.reason };
    }
    p.phase = 'accepted';
    return null;
  }

  state(snapshot: MachineSnapshot, homed = false): Outcome[] {
    const out: Outcome[] = [];
    for (const p of [...this.#items]) {
      if (p.phase !== 'accepted') continue;
      if (confirmedBy(p.command, p.before, snapshot, { before: p.homedBefore, now: homed })) {
        this.#remove(p);
        out.push({ kind: 'confirmed', command: p.command });
      }
    }
    return out;
  }

  /** O que passou do prazo sem confirmação vira um aviso, não um silêncio. */
  expire(now: number, timeoutMs = CONFIRM_TIMEOUT_MS): Outcome[] {
    const out: Outcome[] = [];
    for (const p of [...this.#items]) {
      if (now - p.sentAt < timeoutMs) continue;
      this.#remove(p);
      out.push({ kind: 'failed', command: p.command, reason: p.phase === 'sent' ? 'O servidor não respondeu' : 'A máquina não confirmou' });
    }
    return out;
  }

  clear(): void {
    this.#items = [];
  }

  #remove(p: Pending): void {
    this.#items = this.#items.filter((i) => i !== p);
  }
}

export const UNDO_WINDOW_MS = 30_000;

/** Zerar tem desfazer por 30 s, uma vez só (server/PROTOCOL.md). */
/** O "Desfazer" de um Ir dura menos que o do zero: é um atalho, não uma proteção. */
export const MOVE_UNDO_MS = 10_000;

export class UndoWindow {
  #until: number | null = null;
  #label = '';
  #kind: 'zero' | 'move' = 'zero';
  #ms = UNDO_WINDOW_MS;

  open(label: string, now: number, ms = UNDO_WINDOW_MS, kind: 'zero' | 'move' = 'zero'): void {
    this.#until = now + ms;
    this.#label = label;
    this.#kind = kind;
    this.#ms = ms;
  }

  /** O que o "Desfazer" desfaz: o zero ou o último movimento. */
  get kind(): 'zero' | 'move' {
    return this.#kind;
  }

  get durationMs(): number {
    return this.#ms;
  }

  /** O rótulo a mostrar, ou null se o desfazer já não vale. */
  active(now: number): string | null {
    if (this.#until === null || now >= this.#until) return null;
    return this.#label;
  }

  remainingMs(now: number): number {
    return this.#until === null ? 0 : Math.max(0, this.#until - now);
  }

  /** Usar o desfazer gasta: a segunda vez não há nada para desfazer. */
  take(now: number): boolean {
    const ok = this.active(now) !== null;
    this.#until = null;
    return ok;
  }

  close(): void {
    this.#until = null;
  }
}

/** Palavras para o que está pendente, do ponto de vista de quem opera. */
export const PENDING_LABELS: Partial<Record<CommandName, string>> = {
  unlock: 'Desbloqueando…',
  home: 'Iniciando o homing…',
  feedHold: 'Pausando…',
  resume: 'Retomando…',
  softReset: 'Resetando…',
  cancelJog: 'Parando…',
  spindleOn: 'Ligando…',
  spindleOff: 'Desligando…',
};
