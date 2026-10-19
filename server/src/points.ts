// Os pontos salvos, o "Save X / Y / Z" do Romney no Mach3: uma posição de máquina
// com nome, para voltar depois com o "Posicionar Job" (core/pointApproach). Ficam
// no servidor: são da máquina, valem para todas as telas e sobrevivem a reinícios.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Vec3 } from '@rlight/core';

export interface SavedPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export const MAX_POINTS = 24;
const MAX_NAME = 40;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class PointStore {
  #points: SavedPoint[];
  #next: number;

  constructor(saved: SavedPoint[] | null) {
    this.#points = saved ? saved.map((p) => ({ ...p })) : [];
    this.#next = 1 + Math.max(0, ...this.#points.map((p) => Number(p.id.replace(/^p/, '')) || 0));
  }

  get list(): SavedPoint[] {
    return this.#points.map((p) => ({ ...p }));
  }

  get(id: string): SavedPoint | null {
    const p = this.#points.find((q) => q.id === id);
    return p ? { ...p } : null;
  }

  /** Salva a posição com um nome (vazio vira "Ponto N"). Null quando já há pontos demais. */
  add(name: string, at: Vec3): SavedPoint | null {
    if (this.#points.length >= MAX_POINTS) return null;
    const n = this.#next++;
    const clean = name.trim().slice(0, MAX_NAME) || `Ponto ${n}`;
    const p = { id: `p${n}`, name: clean, x: r3(at.x), y: r3(at.y), z: r3(at.z) };
    this.#points.push(p);
    return { ...p };
  }

  remove(id: string): boolean {
    const before = this.#points.length;
    this.#points = this.#points.filter((p) => p.id !== id);
    return this.#points.length !== before;
  }
}

export interface PointsMemory {
  read(): SavedPoint[] | null;
  write(points: SavedPoint[]): void;
}

export const noPointsMemory: PointsMemory = { read: () => null, write: () => {} };

export function filePointsMemory(path: string): PointsMemory {
  return {
    read() {
      try {
        const v = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        return Array.isArray(v) ? (v as SavedPoint[]).filter((p) => p && typeof p.id === 'string' && typeof p.x === 'number') : null;
      } catch {
        return null;
      }
    },
    write(points) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(points) + '\n');
      } catch {
        // Sem onde gravar: os pontos valem até o próximo reinício.
      }
    },
  };
}
