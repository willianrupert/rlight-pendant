import { describe, expect, it } from 'vitest';
import { DIAL_SWEEP_DEG, angleFromRpm, dialAngle, ringFill, rpmFromAngle, snapRpm, thousandsCrossed } from './spindle';

const r = { min: 3_000, max: 24_000 };

describe('o mostrador', () => {
  it('ângulo e rotação se correspondem nas pontas da faixa do perfil', () => {
    expect(rpmFromAngle(0, r)).toBe(3_000);
    expect(rpmFromAngle(DIAL_SWEEP_DEG, r)).toBe(24_000);
    expect(rpmFromAngle(999, r)).toBe(24_000);
    expect(angleFromRpm(24_000, r)).toBe(DIAL_SWEEP_DEG);
  });

  it('encosta em valores comuns perto, e só dentro da faixa', () => {
    expect(snapRpm(11_800, r)).toBe(12_000);
    expect(snapRpm(13_300, r)).toBe(13_300);
    expect(snapRpm(23_900, { min: 3_000, max: 18_000 })).toBe(18_000);
  });

  it('clica a cada mil', () => {
    expect(thousandsCrossed(11_900, 12_100)).toBe(1);
    expect(thousandsCrossed(12_100, 12_900)).toBe(0);
    expect(thousandsCrossed(15_000, 12_000)).toBe(3);
  });

  it('o arco começa embaixo à esquerda e anda no sentido horário', () => {
    expect(dialAngle(-1, 1)).toBeCloseTo(0, 5); // embaixo à esquerda
    expect(dialAngle(0, -1)).toBeCloseTo(135, 5); // em cima
    expect(dialAngle(1, 1)).toBeCloseTo(270, 5); // embaixo à direita
  });
});

describe('o anel', () => {
  it('segurar enche a primeira parte; o spin-up estimado, o resto', () => {
    expect(ringFill({ holdProgress: 0.5, spinupStartedAt: null, now: 0, spinupMs: 4_000, running: false })).toEqual({ fill: 0.125, phase: 'confirming' });
    expect(ringFill({ holdProgress: 1, spinupStartedAt: 0, now: 2_000, spinupMs: 4_000, running: false })).toEqual({ fill: 0.625, phase: 'spinup' });
    expect(ringFill({ holdProgress: 1, spinupStartedAt: 0, now: 5_000, spinupMs: 4_000, running: true }).phase).toBe('running');
  });

  it('sem estimativa, a confirmação enche tudo', () => {
    expect(ringFill({ holdProgress: 0.5, spinupStartedAt: null, now: 0, spinupMs: 0, running: false }).fill).toBe(0.5);
  });
});
