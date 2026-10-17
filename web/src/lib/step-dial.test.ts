import { describe, expect, it } from 'vitest';
import { dragPosition, formatStep, itemLook, settleIndex, stepLadder } from './step-dial';

describe('o seletor de passo', () => {
  it('cinco décadas a partir do menor passo da máquina', () => {
    expect(stepLadder(0.01)).toEqual([0.01, 0.1, 1, 10, 100]);
    expect(stepLadder(0.02)).toEqual([0.02, 0.2, 2, 20, 200]);
  });

  it('deslizar para a esquerda vai para o passo maior, e para no mais próximo', () => {
    expect(settleIndex(1, -80, 74, 5)).toBe(2);
    expect(settleIndex(1, -20, 74, 5)).toBe(1);
    expect(settleIndex(1, 160, 74, 5)).toBe(0);
    expect(settleIndex(4, -400, 74, 5)).toBe(4);
  });

  it('resiste além das pontas', () => {
    expect(dragPosition(0, 74, 74, 5)).toBeCloseTo(-0.35, 6);
    expect(dragPosition(4, -74, 74, 5)).toBeCloseTo(4.35, 6);
    expect(dragPosition(2, -37, 74, 5)).toBeCloseTo(2.5, 6);
  });

  it('o escolhido é maior; os vizinhos, menores; os de longe somem', () => {
    expect(itemLook(0)).toEqual({ scale: 1, opacity: 1 });
    expect(itemLook(1).scale).toBeLessThan(1);
    expect(itemLook(1).opacity).toBeGreaterThan(0);
    expect(itemLook(2).opacity).toBe(0);
  });

  it('com vírgula', () => {
    expect(formatStep(0.01)).toBe('0,01');
    expect(formatStep(100)).toBe('100');
  });
});
