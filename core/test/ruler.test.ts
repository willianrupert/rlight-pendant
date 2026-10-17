import { describe, expect, it } from 'vitest';
import {
  TAU_MS,
  clickFor,
  dragDelta,
  glidePosition,
  minStepMm,
  planRelease,
  stepOptions,
  velocityFromSamples,
} from '../src/ruler';

// ADR-0010: a régua, com inércia de destino anunciado. Posições em "traços".

describe('velocityFromSamples', () => {
  it('mede a velocidade nos últimos 100 ms', () => {
    const v = velocityFromSamples([
      { t: 0, x: 0 },
      { t: 50, x: 100 },
      { t: 100, x: 200 },
    ]);
    expect(v).toBeCloseTo(2); // px por ms
  });

  it('ignora amostras mais velhas que a janela', () => {
    const v = velocityFromSamples([
      { t: 0, x: 0 },
      { t: 500, x: 0 },
      { t: 550, x: 50 },
      { t: 600, x: 100 },
    ]);
    expect(v).toBeCloseTo(1);
  });

  it('dedo parado ou uma amostra só: velocidade zero', () => {
    expect(velocityFromSamples([{ t: 0, x: 10 }])).toBe(0);
    expect(velocityFromSamples([])).toBe(0);
  });
});

describe('dragDelta', () => {
  it('arrastar para a esquerda avança a régua', () => {
    expect(dragDelta({ dxPx: -44, pxPerTick: 22, pos: 100, minTick: 0, maxTick: 1000 })).toBeCloseTo(2);
  });

  it('fora do curso o arrasto resiste', () => {
    const inside = dragDelta({ dxPx: -22, pxPerTick: 22, pos: 500, minTick: 0, maxTick: 1000 });
    const outside = dragDelta({ dxPx: -22, pxPerTick: 22, pos: 1001, minTick: 0, maxTick: 1000 });
    expect(Math.abs(outside)).toBeLessThan(Math.abs(inside));
  });
});

describe('planRelease: ao soltar o dedo', () => {
  const base = { minTick: 0, maxTick: 12_150 };

  it('soltar devagar assenta no traço mais próximo', () => {
    expect(planRelease({ ...base, pos: 100.4, velocity: 0 })).toEqual({ kind: 'settle', target: 100 });
    expect(planRelease({ ...base, pos: 100.6, velocity: 0.001 })).toEqual({ kind: 'settle', target: 101 });
  });

  it('um peteleco desliza até um destino calculado na hora', () => {
    const p = planRelease({ ...base, pos: 100, velocity: 0.1 }); // 100 traços/s
    expect(p.kind).toBe('glide');
    expect(p.target).toBe(Math.round(100 + 0.1 * TAU_MS));
  });

  it('o destino é sempre um traço inteiro', () => {
    const p = planRelease({ ...base, pos: 100.37, velocity: -0.0731 });
    expect(Number.isInteger(p.target)).toBe(true);
  });

  it('o destino nunca passa do curso', () => {
    expect(planRelease({ ...base, pos: 12_100, velocity: 1 }).target).toBe(12_150);
    expect(planRelease({ ...base, pos: 30, velocity: -1 }).target).toBe(0);
  });

  it('soltar fora do curso volta para o limite', () => {
    expect(planRelease({ ...base, pos: 12_153.7, velocity: 0.5 })).toEqual({ kind: 'settle', target: 12_150 });
    expect(planRelease({ ...base, pos: -2, velocity: 0 })).toEqual({ kind: 'settle', target: 0 });
  });
});

describe('glidePosition: o destino anunciado é a trajetória', () => {
  it('começa onde o dedo soltou', () => {
    expect(glidePosition({ from: 100, target: 132, elapsedMs: 0 })).toBe(100);
  });

  it('se aproxima sem nunca passar do destino', () => {
    let last = 100;
    for (let t = 16; t < 3000; t += 16) {
      const p = glidePosition({ from: 100, target: 132, elapsedMs: t });
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p).toBeLessThanOrEqual(132);
      last = p;
    }
  });

  it('termina exatamente no destino', () => {
    expect(glidePosition({ from: 100, target: 132, elapsedMs: 10 * TAU_MS })).toBe(132);
  });

  it('funciona nos dois sentidos', () => {
    const p = glidePosition({ from: 50, target: 20, elapsedMs: TAU_MS });
    expect(p).toBeLessThan(50);
    expect(p).toBeGreaterThan(20);
  });
});

describe('minStepMm: o menor passo é o que a máquina realmente faz', () => {
  it('máquina de referência, eixo X: 8000 passos em 72,26 mm → 0,01', () => {
    expect(minStepMm(8000 / 72.26)).toBe(0.01);
  });

  it('fuso fino não finge precisão abaixo de 0,01', () => {
    expect(minStepMm(1000)).toBe(0.01);
  });

  it('máquina grosseira sobe para o próximo valor legível', () => {
    expect(minStepMm(40)).toBe(0.05); // 0,025 mm por passo
    expect(minStepMm(80)).toBe(0.02); // 0,0125
    expect(minStepMm(5)).toBe(0.2);
  });

  it('recusa passos por mm inválidos', () => {
    expect(() => minStepMm(0)).toThrow();
  });
});

describe('stepOptions: as três pílulas', () => {
  it('na máquina de referência: 0,01 · 0,1 · 1', () => {
    expect(stepOptions(0.01)).toEqual([0.01, 0.1, 1]);
  });

  it('acompanham o passo mínimo da máquina', () => {
    expect(stepOptions(0.05)).toEqual([0.05, 0.5, 5]);
  });
});

describe('clickFor: o clique respeita o ouvido', () => {
  it('no arrasto, todo traço clica, e o de dez em dez mais forte', () => {
    expect(clickFor({ tick: 7, gliding: false, ticksToTarget: 0 })).toBe('minor');
    expect(clickFor({ tick: 20, gliding: false, ticksToTarget: 0 })).toBe('major');
  });

  it('num deslize rápido, só os traços de dez em dez', () => {
    expect(clickFor({ tick: 7, gliding: true, ticksToTarget: 40 })).toBeNull();
    expect(clickFor({ tick: 30, gliding: true, ticksToTarget: 40 })).toBe('major');
  });

  it('perto do destino, o deslize volta a clicar todo traço', () => {
    expect(clickFor({ tick: 7, gliding: true, ticksToTarget: 5 })).toBe('minor');
  });

  it('traços negativos também marcam de dez em dez', () => {
    expect(clickFor({ tick: -10, gliding: false, ticksToTarget: 0 })).toBe('major');
  });
});
