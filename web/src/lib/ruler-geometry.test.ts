import { describe, expect, it } from 'vitest';
import { BASE_PX_PER_TICK, approach, labelEvery, pxPerTick, reachOf, tickReachable, travelBand } from './ruler-geometry';

describe('o que se vê na régua é o que se alcança', () => {
  it('nos passos finos, o espaço de sempre', () => {
    expect(pxPerTick(0.01, 170)).toBe(BASE_PX_PER_TICK);
    expect(pxPerTick(0.1, 170)).toBe(BASE_PX_PER_TICK);
  });

  it('nos passos grandes, os 4 traços do alcance preenchem meia régua', () => {
    expect(pxPerTick(100, 170)).toBeCloseTo(170 / 4, 6);
    expect(pxPerTick(10, 170)).toBeCloseTo(170 / 4, 6);
    expect(pxPerTick(1, 170)).toBeCloseTo(170 / 4, 6);
  });

  it('o alcance anda com a máquina e respeita o curso', () => {
    expect(reachOf(375, 100, { min: 0, max: 1215 })).toEqual({ lo: 0, hi: 775 });
    expect(reachOf(375, 0.1, null)).toEqual({ lo: 373, hi: 377 });
    expect(reachOf(1214, 1, { min: 0, max: 1215 })).toEqual({ lo: 1210, hi: 1215 });
  });

  it('fora do alcance, apagado', () => {
    const r = { lo: 373, hi: 377 };
    expect(tickReachable(377, r)).toBe(true);
    expect(tickReachable(377.1, r)).toBe(false);
    expect(tickReachable(372.9, r)).toBe(false);
    expect(tickReachable(999, null)).toBe(true);
  });
});

describe('a faixa do que falta andar', () => {
  it('vai do centro até a máquina, para qualquer lado', () => {
    expect(travelBand({ target: 533.99, machine: 375, step: 100, spacing: 42 })).toEqual({ from: (-158.99 / 100) * 42, to: 0 });
    expect(travelBand({ target: 10, machine: 12, step: 1, spacing: 22 })).toEqual({ from: 0, to: 44 });
  });

  it('chegou: sem faixa', () => {
    expect(travelBand({ target: 10, machine: 10.0002, step: 0.01, spacing: 22 })).toBeNull();
  });
});

describe('números e mola', () => {
  it('os números nunca se encostam', () => {
    expect(labelEvery(22)).toBe(5);
    expect(labelEvery(42.5)).toBe(2);
    expect(labelEvery(70)).toBe(1);
  });

  it('a mola chega no alvo e para', () => {
    let v = 22;
    for (let k = 0; k < 60; k++) v = approach(v, 42.5, 16);
    expect(v).toBe(42.5);
    expect(approach(22, 42.5, 16)).toBeGreaterThan(22);
  });
});
