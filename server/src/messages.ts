// O formato das mensagens entre o servidor e os navegadores. Documentado em
// server/PROTOCOL.md; os tipos aqui são a fonte de verdade.

import type {
  Axis,
  AxisValues,
  CombinedLink,
  MachineLimits,
  MachineProfile,
  MachineSnapshot,
} from '@rlight/core';

export const PROTOCOL_VERSION = 1;

/** Os comandos que o servidor sabe executar hoje. */
export type CommandRequest =
  | { command: 'nudge'; axis: Axis; delta: number }
  | { command: 'jogTo'; x: number; y: number }
  | { command: 'cancelJog' | 'unlock' | 'home' | 'softReset' | 'feedHold' | 'resume' };

export type ClientMessage =
  | { type: 'takeControl' }
  | { type: 'releaseControl' }
  | ({ type: 'command'; id?: string } & CommandRequest);

export type ServerMessage =
  | { type: 'welcome'; protocol: number; clientId: string }
  | { type: 'profile'; profile: MachineProfile; limits: MachineLimits }
  | {
      type: 'state';
      machine: MachineSnapshot | null;
      link: CombinedLink;
      /** Alvo comandado por eixo; eixo ausente segue a posição reportada. */
      commanded: AxisValues;
      homed: boolean;
      control: { inControl: boolean; controlled: boolean };
    }
  | { type: 'control'; inControl: boolean; reason?: string }
  | { type: 'result'; id?: string; ok: true; hitLimit?: boolean }
  | { type: 'result'; id?: string; ok: false; reason: string }
  | { type: 'alarm'; code: number }
  | { type: 'invalid'; reason: string };

const SIMPLE = new Set(['cancelJog', 'unlock', 'home', 'softReset', 'feedHold', 'resume']);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Lê uma mensagem do navegador, ou diz por que ela não vale. */
export function parseClientMessage(raw: string): ClientMessage | { invalid: string } {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return { invalid: 'JSON inválido' };
  }
  if (typeof m !== 'object' || m === null) return { invalid: 'Mensagem precisa ser um objeto' };
  const o = m as Record<string, unknown>;
  if (o.type === 'takeControl' || o.type === 'releaseControl') return { type: o.type };
  if (o.type !== 'command') return { invalid: `Tipo desconhecido: ${String(o.type)}` };
  if (o.id !== undefined && typeof o.id !== 'string') return { invalid: 'id precisa ser texto' };
  const id = o.id === undefined ? {} : { id: o.id };
  if (o.command === 'nudge') {
    if (o.axis !== 'x' && o.axis !== 'y' && o.axis !== 'z') return { invalid: 'Eixo inválido' };
    if (!isNum(o.delta)) return { invalid: 'delta inválido' };
    return { type: 'command', ...id, command: 'nudge', axis: o.axis, delta: o.delta };
  }
  if (o.command === 'jogTo') {
    if (!isNum(o.x) || !isNum(o.y)) return { invalid: 'Destino inválido' };
    return { type: 'command', ...id, command: 'jogTo', x: o.x, y: o.y };
  }
  if (typeof o.command === 'string' && SIMPLE.has(o.command)) {
    return { type: 'command', ...id, command: o.command as 'cancelJog' };
  }
  return { invalid: `Comando desconhecido: ${String(o.command)}` };
}
