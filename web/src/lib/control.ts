// O que a tela oferece e como ela sabe que um comando valeu (ADR-0005). A
// policy é a do core, a mesma do servidor: a tela só pergunta e esconde o resto.
// Nada aqui toca o DOM.

import { allowed, type Command, type MachineSnapshot, type MachineState, type PolicyContext } from '@rlight/core';
import type { CommandName, CommandResult } from './connection';

/** Os controles só existem com sinal e com o controle nas mãos (ADR-0007). */
export function controlsVisible(input: { live: boolean; inControl: boolean; hasMachine: boolean }): boolean {
  return input.live && input.inControl && input.hasMachine;
}

/** "Assumir o controle" aparece com sinal, quando esta tela ainda não comanda. */
export function canTakeControl(input: { live: boolean; inControl: boolean; hasMachine: boolean }): boolean {
  return input.live && input.hasMachine && !input.inControl;
}

export interface MachineAction {
  command: Extract<Command, 'unlock' | 'home' | 'feedHold' | 'resume' | 'softReset' | 'cancelJog'>;
  label: string;
  /** O perigoso se confirma segurando. */
  hold: boolean;
  /** O principal do estado vai em destaque; os perigosos ficam longe dele. */
  primary: boolean;
}

const LABELS: Record<MachineAction['command'], string> = {
  unlock: 'Desbloquear',
  home: 'Homing',
  feedHold: 'Pausar',
  resume: 'Retomar',
  softReset: 'Resetar',
  cancelJog: 'Parar',
};

const HOLD = new Set<MachineAction['command']>(['home', 'softReset']);

// Uma coisa por vez (DESIGN.md): o que cada estado mostra, em ordem. Em repouso
// não há Resetar à vista: normal não precisa dele.
const BY_STATE: Record<MachineState, MachineAction['command'][]> = {
  Idle: ['home'],
  Jog: ['cancelJog', 'feedHold'],
  Run: ['feedHold', 'softReset'],
  Hold: ['resume', 'softReset'],
  Alarm: ['unlock', 'home', 'softReset'],
  Home: ['softReset'],
  Door: ['softReset'],
  Check: ['softReset'],
  Sleep: ['softReset'],
};

/** Os botões de máquina deste estado, só os que a policy deixa. */
export function machineActions(
  state: MachineState,
  ctx: PolicyContext & { canHome: boolean; homed: boolean },
): MachineAction[] {
  const list = BY_STATE[state].filter((c) => allowed(c, state, ctx).ok && (c !== 'home' || ctx.canHome));
  // Em repouso, homing só é a ação principal quando ainda falta.
  const out = list.map((command, i) => ({ command, label: LABELS[command], hold: HOLD.has(command), primary: i === 0 && command !== 'softReset' }));
  if (state === 'Idle' && ctx.homed) for (const a of out) a.primary = false;
  return out;
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
    case 'spindleOn':
      return now.spindle > 0;
    case 'spindleOff':
      return now.spindle === 0;
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
export class UndoWindow {
  #until: number | null = null;
  #label = '';

  open(label: string, now: number, ms = UNDO_WINDOW_MS): void {
    this.#until = now + ms;
    this.#label = label;
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
