import { describe, expect, it } from 'vitest';
import { calibrationSteps, fitSpeedMap, formatSpeedMap, percentFor } from './calibration';

// A calibração guiada da rotação: o app liga o spindle em algumas rotações, quem
// opera digita a frequência que o inversor mostra, e sai um speed_map novo.
// O caso real: 900 rpm pedidos giravam a 18,4 Hz (≈ 1.104 rpm).

const reference = [
  { rpm: 0, percent: 0 },
  { rpm: 1800, percent: 10.25 },
  { rpm: 4500, percent: 27.67 },
  { rpm: 9000, percent: 53.77 },
  { rpm: 13500, percent: 76.75 },
  { rpm: 18000, percent: 99.72 },
];

describe('percentFor: o PWM que a placa gera para uma rotação pedida', () => {
  it('interpola entre os pontos do speed_map, como o FluidNC', () => {
    expect(percentFor(reference, 900)).toBeCloseTo(5.125, 6);
    expect(percentFor(reference, 1800)).toBe(10.25);
    expect(percentFor(reference, 30000)).toBe(99.72);
  });
});

describe('calibrationSteps', () => {
  it('as rotações a medir: mais pontos embaixo, onde a curva erra mais, dentro da faixa', () => {
    expect(calibrationSteps({ minRunningRpm: 900, maxRpm: 18000 })).toEqual([900, 1200, 1800, 3000, 4500, 9000, 13500, 18000]);
    expect(calibrationSteps({ minRunningRpm: 3000, maxRpm: 12000 })).toEqual([3000, 4500, 9000, 12000]);
  });
});

describe('fitSpeedMap: a curva verdadeira, das leituras', () => {
  it('cada leitura vira um ponto: a rotação real com o PWM que a gerou', () => {
    const map = fitSpeedMap(reference, [{ commandedRpm: 900, hz: 18.4 }, { commandedRpm: 1800, hz: 31 }], 60);
    expect(map).toEqual([
      { rpm: 0, percent: 0 },
      { rpm: 1104, percent: 5.13 },
      { rpm: 1860, percent: 10.25 },
    ]);
  });

  it('uma leitura fora de ordem (o PWM sobe e a rotação desce) sai, para a curva nunca voltar', () => {
    const map = fitSpeedMap(reference, [{ commandedRpm: 900, hz: 18.4 }, { commandedRpm: 1200, hz: 15 }, { commandedRpm: 1800, hz: 31 }], 60);
    expect(map.map((p) => p.rpm)).toEqual([0, 1104, 1860]);
  });

  it('a linha pronta para o config.yaml do FluidNC', () => {
    expect(formatSpeedMap([{ rpm: 0, percent: 0 }, { rpm: 1104, percent: 5.13 }, { rpm: 18000, percent: 99.72 }])).toBe(
      'speed_map: 0=0.00% 1104=5.13% 18000=99.72%',
    );
  });
});
