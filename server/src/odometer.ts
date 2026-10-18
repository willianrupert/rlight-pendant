// O hodômetro da máquina: quanto cada eixo andou e quanto o spindle ficou ligado,
// hoje (no fuso da oficina) e desde sempre. O servidor já vê cada posição e o
// estado do spindle; somar é de graça. É o embrião dos contadores de manutenção.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MachineState, Vec3 } from '@rlight/core';

export interface OdoTotals {
  x: number;
  y: number;
  z: number;
  spindleMs: number;
}

export interface OdoState {
  /** O dia do "hoje", AAAA-MM-DD no fuso da oficina. */
  day: string;
  today: OdoTotals;
  total: OdoTotals;
}

/** Mais que isto entre dois relatórios não é movimento, é salto (reconexão, reset). */
const MAX_STEP_MM = 300;
/** Um buraco de relatório não vira tempo de spindle além disto. */
const MAX_SPINDLE_GAP_MS = 2_000;

const zero = (): OdoTotals => ({ x: 0, y: 0, z: 0, spindleMs: 0 });
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Odometer {
  #s: OdoState;
  #last: { pos: Vec3; state: MachineState; spindle: boolean; at: number } | null = null;
  readonly #dayOf: (ms: number) => string;

  constructor(saved: OdoState | null, timeZone: string) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    this.#dayOf = (ms) => fmt.format(new Date(ms));
    this.#s = saved ? structuredClone(saved) : { day: '', today: zero(), total: zero() };
  }

  get snapshot(): OdoState {
    return structuredClone(this.#s);
  }

  /** Conexão nova com a placa: o próximo relatório só marca o ponto de partida. */
  reconnected(): void {
    this.#last = null;
  }

  onReport(pos: Vec3 | null, spindleOn: boolean, state: MachineState, now: number): void {
    const day = this.#dayOf(now);
    if (day !== this.#s.day) {
      this.#s.day = day;
      this.#s.today = zero();
    }
    const last = this.#last;
    if (pos && last) {
      // A posição só muda andando: todo trecho conta, mesmo um jog curto que coube
      // entre dois relatórios em Idle. Só um salto (reconexão, reset) fica de fora.
      const d = { x: Math.abs(pos.x - last.pos.x), y: Math.abs(pos.y - last.pos.y), z: Math.abs(pos.z - last.pos.z) };
      if (d.x <= MAX_STEP_MM && d.y <= MAX_STEP_MM && d.z <= MAX_STEP_MM) {
        for (const a of ['x', 'y', 'z'] as const) {
          this.#s.today[a] = r3(this.#s.today[a] + d[a]);
          this.#s.total[a] = r3(this.#s.total[a] + d[a]);
        }
      }
      if (last.spindle) {
        const ms = Math.min(MAX_SPINDLE_GAP_MS, Math.max(0, now - last.at));
        this.#s.today.spindleMs += ms;
        this.#s.total.spindleMs += ms;
      }
    }
    if (pos) this.#last = { pos, state, spindle: spindleOn, at: now };
  }
}

/** Onde guardar o hodômetro, para sobreviver a reinícios. */
export interface OdometerMemory {
  read(): OdoState | null;
  write(s: OdoState): void;
}

export const noOdometerMemory: OdometerMemory = { read: () => null, write: () => {} };

export function fileOdometerMemory(path: string): OdometerMemory {
  return {
    read() {
      try {
        const s = JSON.parse(readFileSync(path, 'utf8')) as OdoState;
        return s && typeof s.day === 'string' && s.today && s.total ? s : null;
      } catch {
        return null;
      }
    },
    write(s) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(s) + '\n');
      } catch {
        // Sem onde gravar: o hodômetro recomeça no próximo reinício.
      }
    },
  };
}
