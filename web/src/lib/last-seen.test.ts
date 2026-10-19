import { describe, expect, it } from 'vitest';
import type { MachineProfile, MachineSnapshot } from '@rlight/core';
import { LastSeenStore, lastSeenCaption, parseLastSeen, snapshotOf, type LastSeen } from './last-seen';

// O último estado visto ao vivo, guardado no aparelho para o app abrir já
// mostrando algo. Sempre marcado como antigo; nunca vira controle.

const machine = (over: Partial<MachineSnapshot> = {}): MachineSnapshot => ({
  state: 'Idle',
  subState: null,
  mpos: { x: 10, y: 20, z: -5 },
  wpos: null,
  wco: null,
  feed: 0,
  spindle: 0,
  overrides: null,
  sd: null,
  pins: '',
  spindleOn: false,
  ...over,
});

const profile = { name: 'Router da oficina', axes: { x: {}, y: {}, z: {} } } as unknown as MachineProfile;

class MemoryStorage {
  data = new Map<string, string>();
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('snapshotOf: só o que a tela mostra, nada de controle', () => {
  it('posição da máquina sem zero de peça', () => {
    expect(snapshotOf(machine(), true, profile, 1_000)).toEqual({
      v: 1,
      at: 1_000,
      state: 'Idle',
      homed: true,
      pos: { x: 10, y: 20, z: -5 },
      work: false,
      name: 'Router da oficina',
      axes: ['x', 'y', 'z'],
    });
  });

  it('com zero de peça, a posição da peça (como o DRO mostra)', () => {
    const s = snapshotOf(machine({ wco: { x: 1, y: 1, z: 1 }, wpos: { x: 9, y: 19, z: -6 } }), false, null, 5);
    expect(s).toMatchObject({ pos: { x: 9, y: 19, z: -6 }, work: true, name: null, axes: ['x', 'y', 'z'] });
  });

  it('sem posição não há o que lembrar', () => {
    expect(snapshotOf(machine({ mpos: null }), true, profile, 1)).toBeNull();
  });

  it('não guarda controle, token nem nada além disto', () => {
    const s = snapshotOf(machine(), true, profile, 1)!;
    expect(Object.keys(s).sort()).toEqual(['at', 'axes', 'homed', 'name', 'pos', 'state', 'v', 'work']);
  });
});

describe('parseLastSeen: o que vem do aparelho não é confiável', () => {
  const good: LastSeen = snapshotOf(machine(), true, profile, 1_000)!;

  it('lê o que guardou', () => {
    expect(parseLastSeen(JSON.stringify(good))).toEqual(good);
  });

  it('lixo, versão velha ou campos errados: nada', () => {
    expect(parseLastSeen(null)).toBeNull();
    expect(parseLastSeen('{')).toBeNull();
    expect(parseLastSeen('null')).toBeNull();
    expect(parseLastSeen(JSON.stringify({ ...good, v: 0 }))).toBeNull();
    expect(parseLastSeen(JSON.stringify({ ...good, pos: { x: 1, y: 'a', z: 3 } }))).toBeNull();
    expect(parseLastSeen(JSON.stringify({ ...good, state: 'Dançando' }))).toBeNull();
    expect(parseLastSeen(JSON.stringify({ ...good, at: 'ontem' }))).toBeNull();
    expect(parseLastSeen(JSON.stringify({ ...good, axes: ['x', 'w'] }))).toBeNull();
  });
});

describe('LastSeenStore', () => {
  it('guarda no máximo uma vez por segundo, e o flush grava o que ficou', () => {
    const storage = new MemoryStorage();
    const store = new LastSeenStore(storage);
    store.remember(snapshotOf(machine(), true, profile, 1_000));
    store.remember(snapshotOf(machine({ mpos: { x: 11, y: 20, z: -5 } }), true, profile, 1_400));
    expect(storage.writes).toBe(1);
    expect(store.recall()?.pos.x).toBe(10);
    store.remember(snapshotOf(machine({ mpos: { x: 12, y: 20, z: -5 } }), true, profile, 2_100));
    expect(storage.writes).toBe(2);
    store.remember(snapshotOf(machine({ mpos: { x: 13, y: 20, z: -5 } }), true, profile, 2_300));
    store.flush();
    expect(store.recall()?.pos.x).toBe(13);
    store.flush();
    expect(storage.writes).toBe(3);
  });

  it('sem armazenamento (modo privado, bloqueado), nada quebra', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
      removeItem: () => {},
    };
    const store = new LastSeenStore(broken);
    expect(() => store.remember(snapshotOf(machine(), true, profile, 1))).not.toThrow();
    expect(() => store.flush()).not.toThrow();
    expect(store.recall()).toBeNull();
    expect(new LastSeenStore(null).recall()).toBeNull();
  });
});

describe('lastSeenCaption: sempre dizendo que é antigo', () => {
  const seen = (at: number, state: LastSeen['state'] = 'Idle') => ({ ...snapshotOf(machine({ state }), true, profile, at)! });

  it('diz o estado e há quanto tempo', () => {
    expect(lastSeenCaption(seen(0), 5_000)).toBe('Última leitura · Em repouso · há instantes');
    expect(lastSeenCaption(seen(0), 3 * 60_000)).toBe('Última leitura · Em repouso · há 3 min');
    expect(lastSeenCaption(seen(0, 'Alarm'), 2 * 3_600_000 + 5)).toBe('Última leitura · Alarme · há 2 h');
    expect(lastSeenCaption(seen(0), 3 * 86_400_000)).toBe('Última leitura · Em repouso · há 3 dias');
    expect(lastSeenCaption(seen(0), 86_400_000)).toBe('Última leitura · Em repouso · há 1 dia');
  });

  it('relógio do aparelho para trás não vira "no futuro"', () => {
    expect(lastSeenCaption(seen(10_000), 0)).toBe('Última leitura · Em repouso · há instantes');
  });
});
