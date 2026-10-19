// Retomar de onde parou. O servidor lembra a última posição em que a máquina
// ficou parada com o homing valendo (gravada, para sobreviver a reinícios).
// Quando o homing se perde (a máquina foi desligada, ou um alarme perdeu a
// posição) e volta, ele oferece voltar para lá, pelo mesmo caminho seguro da
// volta a um ponto salvo. Continuidade, como o Handoff: desliga no almoço, volta
// para o mesmo lugar.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Vec3 } from '@rlight/core';

/** A oferta de voltar vale por esse tempo depois do homing. */
export const RESUME_OFFER_MS = 15 * 60_000;
/** Mais perto que isto do lugar de antes, não há para onde voltar. */
const SAME_PLACE_MM = 1;

export interface Still {
  pos: Vec3;
  at: number;
}

export class ResumeTracker {
  #still: Still | null;
  #candidate: Still | null = null;
  #offer: Still | null = null;
  #lost = false;

  constructor(saved: Still | null) {
    this.#still = saved ? { pos: { ...saved.pos }, at: saved.at } : null;
  }

  get still(): Still | null {
    return this.#still ? { pos: { ...this.#still.pos }, at: this.#still.at } : null;
  }

  /** A máquina parada com o homing valendo. Devolve se a lembrança mudou (para gravar). */
  onStill(pos: Vec3, now: number): boolean {
    if (this.#lost) return false;
    const s = this.#still;
    if (s && Math.abs(s.pos.x - pos.x) < 0.001 && Math.abs(s.pos.y - pos.y) < 0.001 && Math.abs(s.pos.z - pos.z) < 0.001) return false;
    this.#still = { pos: { ...pos }, at: now };
    return true;
  }

  /** O homing se perdeu: a última posição boa vira a candidata a voltar. */
  homingLost(): void {
    this.#lost = true;
    if (this.#still && !this.#candidate) this.#candidate = this.#still;
  }

  /** O homing voltou: se a máquina está longe de onde estava, oferece voltar. */
  homingRegained(current: Vec3, now: number): Vec3 | null {
    this.#lost = false;
    const c = this.#candidate;
    this.#candidate = null;
    if (!c) return null;
    if (Math.hypot(c.pos.x - current.x, c.pos.y - current.y, c.pos.z - current.z) < SAME_PLACE_MM) return null;
    this.#offer = { pos: { ...c.pos }, at: now };
    return { ...c.pos };
  }

  offer(now: number): Still | null {
    const o = this.#offer;
    if (!o || now - o.at > RESUME_OFFER_MS) return null;
    return { pos: { ...o.pos }, at: o.at };
  }

  clearOffer(): void {
    this.#offer = null;
  }
}

export interface ResumeMemory {
  read(): Still | null;
  write(s: Still): void;
}

export const noResumeMemory: ResumeMemory = { read: () => null, write: () => {} };

export function fileResumeMemory(path: string): ResumeMemory {
  return {
    read() {
      try {
        const s = JSON.parse(readFileSync(path, 'utf8')) as Still;
        return s && s.pos && typeof s.pos.x === 'number' ? s : null;
      } catch {
        return null;
      }
    },
    write(s) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(s) + '\n');
      } catch {
        // Sem onde gravar: retomar só vale até o próximo reinício.
      }
    },
  };
}
