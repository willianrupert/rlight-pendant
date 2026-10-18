// Como a máquina aparece para quem opera (DESIGN.md): palavras do lado de cá da
// tela, vírgula decimal, nenhum código cru.

import type { CombinedLink, MachineState } from '@rlight/core';

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

// Códigos de alarme do Grbl, herdados pelo FluidNC: só a causa. A ação vem do
// estado real (o homing ainda vale ou não), para a frase e o botão em destaque
// dizerem a mesma coisa.
const ALARMS: Record<number, string> = {
  1: 'Um fim de curso foi acionado.',
  2: 'Um movimento passaria do curso da máquina e foi barrado.',
  3: 'A máquina foi resetada no meio de um movimento.',
  4: 'O apalpador já estava acionado antes de começar.',
  5: 'O apalpador não encostou em nada.',
  6: 'O homing foi interrompido.',
  7: 'O homing parou porque a porta abriu.',
  8: 'O homing não conseguiu se afastar do fim de curso.',
  9: 'O homing não encontrou o fim de curso.',
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
    const cause = ALARMS[input.alarmCode] ?? `A máquina entrou em alarme (código ${input.alarmCode}).`;
    return { ...base, detail: `${cause} ${action}` };
  }
  if (!input.homed) return { ...base, detail: 'A máquina precisa de homing antes de se mover.' };
  // Sem código e com o homing valendo: um reset (o Resetar, ou desligar o spindle no spin-up).
  return { ...base, detail: `A placa foi resetada e está travada. ${action}` };
}

/** A única linha sobre conexão. Ao vivo não diz nada: normal não precisa de aviso. */
export function linkLine(link: CombinedLink): string | null {
  if (link.mode === 'live') return link.showBack ? 'De volta' : null;
  if (link.ageMs === null) return 'Procurando a máquina';
  const s = Math.floor(link.ageMs / 1000);
  const age = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
  return `Sem sinal da máquina · há ${age}`;
}
