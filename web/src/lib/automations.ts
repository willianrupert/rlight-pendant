// A tela de Automações: a placa de toque hoje, as receitas do Romney depois
// (docs/RECEITAS.md). A tela de controle não ganha botões; tudo o que é
// automático mora aqui. Puro: as frases e a leitura dos números.

export type ProbeStatus = 'seeking' | 'measuring' | 'done' | 'failed';

export interface ProbeProgress {
  status: ProbeStatus;
  reason?: string;
}

/** O que a máquina está fazendo na medição, numa frase; nada antes de começar. */
export function probeLine(p: ProbeProgress | null): string | null {
  if (!p) return null;
  switch (p.status) {
    case 'seeking':
      return 'Descendo até encostar na placa…';
    case 'measuring':
      return 'Encostou. Medindo de novo, devagar…';
    case 'done':
      return 'Z zerado. A fresa está 5 mm acima da placa.';
    case 'failed':
      return p.reason ?? 'A medição não terminou.';
  }
}

export interface OdoTotals {
  x: number;
  y: number;
  z: number;
  spindleMs: number;
}

export interface Odometer {
  day: string;
  today: OdoTotals;
  total: OdoTotals;
}

const comma = (v: number, digits: number) => v.toFixed(digits).replace('.', ',');

/** Quanto um eixo andou: mm perto, metros, quilômetros. */
export function formatDistance(mm: number): string {
  if (mm < 1_000) return `${Math.round(mm)} mm`;
  if (mm < 1_000_000) return `${comma(mm / 1_000, 1)} m`;
  return `${comma(mm / 1_000_000, 2)} km`;
}

/** Quanto tempo: segundos, minutos, horas e minutos. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1_000);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** A espessura digitada, em mm (vírgula ou ponto), ou null se não vale (0 a 50 mm). */
export function parseThickness(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  if (!text.trim() || !Number.isFinite(v) || v <= 0 || v > 50) return null;
  return v;
}
