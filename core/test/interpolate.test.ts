import { describe, expect, it } from 'vitest';
import { ReportBuffer, displayValue } from '../src/interpolate';

// ADR-0009: desenhar um relatório atrás, deslizando entre dois valores reais.
// Cada número na tela fica entre dois valores que a máquina reportou.

const r = (at: number, value: number) => ({ at, value });

describe('displayValue', () => {
  it('sem relatório, nada a mostrar', () => {
    expect(displayValue([], 1_000, 100)).toBeNull();
  });

  it('com um relatório só, mostra ele', () => {
    expect(displayValue([r(1_000, 5)], 1_050, 100)).toBe(5);
  });

  it('desliza entre os dois relatórios que cercam o instante desenhado', () => {
    // Desenha em now - delay = 1_150: metade do caminho entre 1_100 e 1_200.
    expect(displayValue([r(1_000, 0), r(1_100, 10), r(1_200, 20)], 1_250, 100)).toBeCloseTo(15);
  });

  it('nunca extrapola: além do último relatório, segura o último', () => {
    expect(displayValue([r(1_000, 0), r(1_100, 10)], 5_000, 100)).toBe(10);
  });

  it('antes do primeiro relatório, mostra o primeiro', () => {
    expect(displayValue([r(1_000, 3), r(1_100, 4)], 1_050, 100)).toBe(3);
  });

  it('o valor desenhado está sempre entre dois valores reportados', () => {
    const reports = [r(0, 2), r(100, 9), r(200, -4), r(300, 7), r(400, 7.5)];
    for (let now = 0; now <= 700; now += 7) {
      const v = displayValue(reports, now, 100)!;
      expect(v).toBeGreaterThanOrEqual(-4);
      expect(v).toBeLessThanOrEqual(9);
      const k = reports.findIndex((x) => x.at > now - 100);
      if (k > 0) {
        const lo = Math.min(reports[k - 1]!.value, reports[k]!.value);
        const hi = Math.max(reports[k - 1]!.value, reports[k]!.value);
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
});

describe('ReportBuffer', () => {
  it('guarda só os relatórios recentes', () => {
    const b = new ReportBuffer(3);
    for (let i = 0; i < 10; i++) b.push(r(i * 100, i));
    expect(b.items.map((x) => x.value)).toEqual([7, 8, 9]);
  });

  it('descarta relatório fora de ordem, que chegou atrasado', () => {
    const b = new ReportBuffer(8);
    b.push(r(100, 1));
    b.push(r(300, 3));
    b.push(r(200, 2));
    expect(b.items.map((x) => x.at)).toEqual([100, 300]);
  });

  it('limpar esquece tudo, como numa reconexão', () => {
    const b = new ReportBuffer(8);
    b.push(r(100, 1));
    b.clear();
    expect(b.items).toEqual([]);
  });
});
