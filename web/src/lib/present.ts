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

// Códigos de alarme do Grbl, herdados pelo FluidNC.
const ALARMS: Record<number, string> = {
  1: 'Um fim de curso foi acionado. Afaste o eixo e desbloqueie.',
  2: 'Um movimento passaria do curso da máquina e foi barrado.',
  3: 'A máquina foi resetada no meio de um movimento. Faça o homing de novo.',
  4: 'O apalpador já estava acionado antes de começar.',
  5: 'O apalpador não encostou em nada.',
  6: 'O homing foi interrompido.',
  7: 'O homing parou porque a porta abriu.',
  8: 'O homing não conseguiu se afastar do fim de curso.',
  9: 'O homing não encontrou o fim de curso.',
};

export function presentState(input: { state: MachineState | null; homed: boolean; alarmCode?: number | null }): Presentation {
  if (!input.state) return { label: 'Conectando', tone: 'idle' };
  const base = STATES[input.state];
  if (input.state !== 'Alarm') return { ...base };
  if (input.alarmCode != null) {
    return { ...base, detail: ALARMS[input.alarmCode] ?? `A máquina entrou em alarme (código ${input.alarmCode}).` };
  }
  if (!input.homed) return { ...base, detail: 'A máquina precisa de homing antes de se mover.' };
  return { ...base, detail: 'A máquina está em alarme. Desbloqueie para continuar.' };
}

/** A única linha sobre conexão. Ao vivo não diz nada: normal não precisa de aviso. */
export function linkLine(link: CombinedLink): string | null {
  if (link.mode === 'live') return link.showBack ? 'De volta' : null;
  if (link.ageMs === null) return 'Procurando a máquina';
  const s = Math.floor(link.ageMs / 1000);
  const age = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
  return `Sem sinal da máquina · há ${age}`;
}
