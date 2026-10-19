import { describe, expect, it } from 'vitest';
import { MAX_POINTS, PointStore } from '../src/points';

describe('PointStore: o Save X/Y/Z do Romney', () => {
  it('salva com nome, ou "Ponto N" sem nome, e devolve a lista', () => {
    const s = new PointStore(null);
    expect(s.add('  Canto da peça ', { x: 100.12345, y: 200, z: -68 })).toEqual({ id: 'p1', name: 'Canto da peça', x: 100.123, y: 200, z: -68 });
    expect(s.add('', { x: 0, y: 0, z: 0 })?.name).toBe('Ponto 2');
    expect(s.list.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('remove pelo id; um id novo nunca reaproveita um apagado', () => {
    const s = new PointStore(null);
    s.add('a', { x: 0, y: 0, z: 0 });
    s.add('b', { x: 0, y: 0, z: 0 });
    expect(s.remove('p1')).toBe(true);
    expect(s.add('c', { x: 0, y: 0, z: 0 })?.id).toBe('p3');
  });

  it('continua de onde parou (o que foi salvo)', () => {
    const s = new PointStore([{ id: 'p7', name: 'x', x: 1, y: 2, z: 3 }]);
    expect(s.add('y', { x: 0, y: 0, z: 0 })?.id).toBe('p8');
    expect(s.get('p7')?.name).toBe('x');
  });

  it('tem um limite, para a mesa não virar um paliteiro', () => {
    const s = new PointStore(null);
    for (let i = 0; i < MAX_POINTS; i++) s.add('', { x: 0, y: 0, z: 0 });
    expect(s.add('', { x: 0, y: 0, z: 0 })).toBeNull();
  });
});
