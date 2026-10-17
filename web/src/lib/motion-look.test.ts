import { describe, expect, it } from 'vitest';
import { heading, speedText, speedVisible, trailPx, wallsFor } from './motion-look';

describe('a velocidade real', () => {
  it('aparece só andando, com a velocidade da placa', () => {
    expect(speedVisible('Jog', 2940)).toBe(true);
    expect(speedVisible('Run', 800)).toBe(true);
    expect(speedVisible('Jog', 0)).toBe(false);
    expect(speedVisible('Idle', 0)).toBe(false);
    expect(speedVisible('Idle', 120)).toBe(false);
    expect(speedVisible(null, 120)).toBe(false);
  });

  it('com ponto de milhar', () => {
    expect(speedText(2940)).toBe('2.940 mm/min');
  });

  it('o rastro cresce com a velocidade, até um teto', () => {
    expect(trailPx(0)).toBe(0);
    expect(trailPx(1500)).toBeCloseTo(17, 6);
    expect(trailPx(3000)).toBe(34);
    expect(trailPx(9000)).toBe(34);
  });

  it('a direção do movimento', () => {
    expect(heading({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(heading({ x: 0, y: 0 }, { x: 0.001, y: 0 })).toBeNull();
  });
});

describe('as paredes da régua', () => {
  it('início e fim do curso em qualquer eixo', () => {
    expect(wallsFor({ min: 0, max: 1215 }, null)).toEqual([
      { value: 0, kind: 'limit' },
      { value: 1215, kind: 'limit' },
    ]);
  });

  it('no Z, também a superfície da peça, se cabe no curso', () => {
    expect(wallsFor({ min: -158, max: 0 }, -40)).toContainEqual({ value: -40, kind: 'zero' });
    expect(wallsFor({ min: -158, max: 0 }, 0)).toHaveLength(2);
  });

  it('sem curso conhecido (sem homing), nenhuma parede de curso', () => {
    expect(wallsFor(null, null)).toEqual([]);
  });
});
