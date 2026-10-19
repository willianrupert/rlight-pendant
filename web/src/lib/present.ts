// Como a máquina aparece para quem opera (DESIGN.md): palavras do lado de cá da
// tela, vírgula decimal, nenhum código cru.

import { alarmCause, type CombinedLink, type MachineState } from '@rlight/core';

const MINUS = '−';

export function splitMm(v: number): { sign: string; int: string; dec: string } {
  const r = Math.round(v * 100) / 100;
  const [i, d] = Math.abs(r).toFixed(2).split('.') as [string, string];
  return { sign: r < 0 ? MINUS : '', int: i.replace(/\B(?=(\d{3})+(?!\d))/g, '.'), dec: d };
}

export function formatMm(v: number): string {
  const s = splitMm(v);
  return `${s.sign}${s.int},${s.dec}`;
}

const thousands = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const formatRpm = thousands;
export const formatFeed = thousands;

export type Tone = 'idle' | 'moving' | 'hold' | 'alarm';

export interface Presentation {
  label: string;
  tone: Tone;
  detail?: string;
}

const STATES: Record<MachineState, { label: string; tone: Tone }> = {
  Idle: { label: 'Em repouso', tone: 'idle' },
  Jog: { label: 'Movendo', tone: 'moving' },
  Run: { label: 'Cortando', tone: 'moving' },
  Hold: { label: 'Em pausa', tone: 'hold' },
  Alarm: { label: 'Alarme', tone: 'alarm' },
  Home: { label: 'Fazendo homing', tone: 'moving' },
  Door: { label: 'Porta aberta', tone: 'hold' },
  Check: { label: 'Verificando G-code', tone: 'idle' },
  Sleep: { label: 'Em repouso', tone: 'idle' },
};

// Os error:n do Grbl/FluidNC que um comando do app pode receber.
const BOARD_ERRORS: Record<number, string> = {
  8: 'espere a máquina parar.',
  9: 'a máquina está travada.',
  15: 'o destino passa do curso da máquina.',
};

/** Uma recusa da placa, numa frase. */
export function boardErrorText(code: number): string {
  const why = BOARD_ERRORS[code];
  return why ? `A placa recusou: ${why}` : `A placa recusou o comando (erro ${code}).`;
}

/** O que resolve o alarme agora: homing se a posição se perdeu, desbloquear se não. */
export function alarmAction(homed: boolean): 'home' | 'unlock' {
  return homed ? 'unlock' : 'home';
}

export function presentState(input: { state: MachineState | null; homed: boolean; alarmCode?: number | null }): Presentation {
  if (!input.state) return { label: 'Conectando', tone: 'idle' };
  const base = STATES[input.state];
  if (input.state !== 'Alarm') return { ...base };
  const action = alarmAction(input.homed) === 'home' ? 'Faça o homing para continuar.' : 'Desbloqueie para continuar.';
  if (input.alarmCode != null) {
    return { ...base, detail: `${alarmCause(input.alarmCode)} ${action}` };
  }
  if (!input.homed) return { ...base, detail: 'A máquina precisa de homing antes de se mover.' };
  // Sem código e com o homing valendo: um reset (o Resetar, ou desligar o spindle no spin-up).
  return { ...base, detail: `A placa foi resetada e está travada. ${action}` };
}

/** A única linha sobre conexão. Ao vivo não diz nada: normal não precisa de aviso. */
export function linkLine(link: CombinedLink): string | null {
  if (link.mode === 'live') return link.showBack ? 'De volta' : null;
  if (link.ageMs === null) return 'Procurando a máquina';
  const long = link.ageMs >= LONG_SILENCE_MS;
  // Quem não responde é o servidor: o problema está no celular ou na rede, não na máquina.
  if (link.failedHop === 'server') {
    return long ? 'Sem conexão com o servidor. Confira se o celular está na rede da oficina.' : `Sem conexão com o servidor · há ${age(link.ageMs)}`;
  }
  // Calada há muito tempo, a máquina quase sempre está desligada: contar minutos não ajuda.
  if (long) return 'Ligue o painel da CNC. Se já está ligado, confira o Wi-Fi da placa.';
  return `Sem sinal da máquina · há ${age(link.ageMs)}`;
}

/** O título quando a máquina está calada há muito tempo; null mantém o de sempre. */
export function linkTitle(link: CombinedLink): string | null {
  if (link.mode !== 'no-signal' || link.failedHop !== 'machine' || link.ageMs === null) return null;
  return link.ageMs >= LONG_SILENCE_MS ? 'Máquina desligada' : null;
}

/** Depois disto sem sinal, deixa de ser uma queda e vira "desligada". */
const LONG_SILENCE_MS = 5 * 60_000;

function age(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}
