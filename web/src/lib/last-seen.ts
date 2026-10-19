// O último estado visto ao vivo, guardado no aparelho para o app abrir já
// mostrando algo, mesmo sem rede. Só para os olhos: sempre marcado como
// antigo, e nada de controle sai daqui (os controles exigem sinal ao vivo).

import { MACHINE_STATES, type Axis, type MachineProfile, type MachineSnapshot, type MachineState, type Vec3 } from '@rlight/core';
import { presentState } from './present';

export interface LastSeen {
  v: 1;
  /** Quando foi visto ao vivo (Date.now()). */
  at: number;
  state: MachineState;
  homed: boolean;
  /** A posição como o DRO mostra: da peça com zero de peça, senão da máquina. */
  pos: Vec3;
  work: boolean;
  name: string | null;
  axes: Axis[];
}

const KEY = 'rlight.lastSeen';
const AXES: Axis[] = ['x', 'y', 'z'];
const SAVE_EVERY_MS = 1_000;

export function snapshotOf(m: MachineSnapshot, homed: boolean, profile: MachineProfile | null, at: number): LastSeen | null {
  const pos = m.wco ? m.wpos : m.mpos;
  if (!pos) return null;
  return {
    v: 1,
    at,
    state: m.state,
    homed,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    work: !!m.wco,
    name: profile?.name ?? null,
    axes: profile ? AXES.filter((a) => profile.axes[a]) : AXES,
  };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseLastSeen(raw: string | null): LastSeen | null {
  if (!raw) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const pos = s.pos as Record<string, unknown> | null | undefined;
  const ok =
    s.v === 1 &&
    num(s.at) &&
    (MACHINE_STATES as readonly unknown[]).includes(s.state) &&
    typeof s.homed === 'boolean' &&
    !!pos &&
    num(pos.x) &&
    num(pos.y) &&
    num(pos.z) &&
    typeof s.work === 'boolean' &&
    (s.name === null || typeof s.name === 'string') &&
    Array.isArray(s.axes) &&
    s.axes.every((a) => (AXES as unknown[]).includes(a));
  if (!ok || !pos) return null;
  return {
    v: 1,
    at: s.at as number,
    state: s.state as MachineState,
    homed: s.homed as boolean,
    pos: { x: pos.x as number, y: pos.y as number, z: pos.z as number },
    work: s.work as boolean,
    name: s.name as string | null,
    axes: s.axes as Axis[],
  };
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage com tolerância: sem ele, o app só abre sem o último estado. */
export class LastSeenStore {
  #pending: LastSeen | null = null;
  #savedAt = -Infinity;

  constructor(private readonly storage: StorageLike | null) {}

  /** Guarda no máximo uma vez por segundo; o resto fica para o próximo ou para o flush. */
  remember(seen: LastSeen | null): void {
    if (!seen) return;
    this.#pending = seen;
    if (seen.at - this.#savedAt >= SAVE_EVERY_MS) this.flush();
  }

  /** Grava o que ficou pendente (ao sair do app). */
  flush(): void {
    const s = this.#pending;
    if (!s) return;
    this.#pending = null;
    this.#savedAt = s.at;
    try {
      this.storage?.setItem(KEY, JSON.stringify(s));
    } catch {
      /* cheio ou bloqueado */
    }
  }

  recall(): LastSeen | null {
    try {
      return parseLastSeen(this.storage?.getItem(KEY) ?? null);
    } catch {
      return null;
    }
  }
}

/** A linha sob os números enquanto o que aparece é o lembrado: sempre diz que é antigo. */
export function lastSeenCaption(seen: LastSeen, now: number): string {
  return `Última leitura · ${presentState({ state: seen.state, homed: seen.homed }).label} · há ${ago(now - seen.at)}`;
}

function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'instantes';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

export function browserStorage(): StorageLike | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
