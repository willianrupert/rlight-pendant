// O que é permitido em cada estado (ADR-0005). A interface pergunta aqui e
// esconde o resto; o servidor pergunta aqui antes de mandar qualquer coisa à placa.

import type { LinkMode } from './link';

/** Estados do relatório do FluidNC (os subestados, como `Hold:0`, chegam já resumidos). */
export const MACHINE_STATES = ['Idle', 'Jog', 'Run', 'Hold', 'Alarm', 'Home', 'Door', 'Check', 'Sleep'] as const;
export type MachineState = (typeof MACHINE_STATES)[number];

export const COMMANDS = [
  'unlock',
  'home',
  'softReset',
  'feedHold',
  'resume',
  'jogTo',
  'jogAxisTo',
  'nudge',
  'cancelJog',
  'zero',
  'undoZero',
  'spindleOn',
  'spindleOff',
  'spindleSpeed',
  'probeZ',
] as const;
export type Command = (typeof COMMANDS)[number];

export interface PolicyContext {
  link: LinkMode;
  /** Esta tela tem o controle; as outras só assistem (ADR-0001). */
  inControl: boolean;
  /** Sem homing, a posição de máquina não significa nada. */
  homed: boolean;
}

export type Decision = { ok: true } | { ok: false; reason: string };

const PERMITTED: Record<MachineState, readonly Command[]> = {
  Idle: ['home', 'softReset', 'jogTo', 'jogAxisTo', 'nudge', 'zero', 'undoZero', 'spindleOn', 'spindleOff', 'spindleSpeed', 'probeZ'],
  Jog: ['softReset', 'feedHold', 'cancelJog', 'jogTo', 'jogAxisTo', 'nudge'],
  Run: ['softReset', 'feedHold', 'spindleSpeed'],
  Hold: ['softReset', 'resume', 'spindleOff'],
  Alarm: ['unlock', 'home', 'softReset'],
  Home: ['softReset'],
  Door: ['softReset'],
  Check: ['softReset'],
  Sleep: ['softReset'],
};

const BLOCKED_BECAUSE: Record<MachineState, string> = {
  Idle: 'Nada em andamento',
  Jog: 'Espere o movimento terminar',
  Run: 'Não durante um corte',
  Hold: 'A máquina está em pausa',
  Alarm: 'Desbloqueie a máquina primeiro',
  Home: 'Espere o homing terminar',
  Door: 'A porta está aberta',
  Check: 'Modo de verificação de G-code',
  Sleep: 'A máquina está em repouso',
};

export function allowed(command: Command, state: MachineState, ctx: PolicyContext): Decision {
  if (ctx.link !== 'live') return { ok: false, reason: 'Sem sinal da máquina' };
  if (!ctx.inControl) return { ok: false, reason: 'Outra tela está no controle' };
  if (!PERMITTED[state].includes(command)) {
    const reason = state === 'Idle' && command === 'unlock' ? 'A máquina já está desbloqueada' : BLOCKED_BECAUSE[state];
    return { ok: false, reason };
  }
  if (command === 'jogTo' && !ctx.homed) return { ok: false, reason: 'Faça o homing para mover pelo mapa' };
  if (command === 'jogAxisTo' && !ctx.homed) return { ok: false, reason: 'Faça o homing para mover até um ponto' };
  return { ok: true };
}
