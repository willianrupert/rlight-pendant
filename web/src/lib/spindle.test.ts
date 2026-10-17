import { describe, expect, it } from 'vitest';
import { DIAL_SWEEP_DEG, OFF, OFF_DEG, angleFromRpm, dialAngle, releaseAction, ringFill, rpmFromAngle, snapRpm, spindleButtons, thousandsCrossed } from './spindle';

const r = { min: 1_800, max: 24_000 }; // minRunningRpm..maxRpm da máquina de referência

describe('o mostrador', () => {
  it('o começo do arco é o desligado; depois, da menor rotação que gira até a máxima', () => {
    expect(rpmFromAngle(0, r)).toBe(OFF);
    expect(rpmFromAngle(OFF_DEG, r)).toBe(1_800);
    expect(rpmFromAngle(DIAL_SWEEP_DEG, r)).toBe(24_000);
    expect(rpmFromAngle(999, r)).toBe(24_000);
    expect(angleFromRpm(OFF, r)).toBe(0);
    expect(angleFromRpm(1_800, r)).toBe(OFF_DEG);
    expect(angleFromRpm(24_000, r)).toBe(DIAL_SWEEP_DEG);
  });

  it('nunca uma rotação entre o desligado e o mínimo', () => {
    for (let a = 0; a <= DIAL_SWEEP_DEG; a += 1) {
      const v = rpmFromAngle(a, r);
      expect(v === OFF || v >= 1_800).toBe(true);
    }
  });

  it('soltar com o spindle ligado: ajusta, ou no desligado desliga', () => {
    expect(releaseAction({ rpm: 9_000, on: true, canAdjust: true, canStop: true })).toEqual({ command: 'spindleSpeed', rpm: 9_000 });
    expect(releaseAction({ rpm: OFF, on: true, canAdjust: true, canStop: true })).toEqual({ command: 'spindleOff' });
    expect(releaseAction({ rpm: 9_000, on: false, canAdjust: true, canStop: true })).toBeNull();
  });

  it('encosta em valores comuns perto, e só dentro da faixa', () => {
    expect(snapRpm(11_800, r)).toBe(12_000);
    expect(snapRpm(13_300, r)).toBe(13_300);
    expect(snapRpm(23_900, { min: 3_000, max: 18_000 })).toBe(18_000);
    expect(snapRpm(OFF, r)).toBe(OFF);
  });

  it('clica a cada mil', () => {
    expect(thousandsCrossed(11_900, 12_100)).toBe(1);
    expect(thousandsCrossed(12_100, 12_900)).toBe(0);
    expect(thousandsCrossed(15_000, 12_000)).toBe(3);
    expect(thousandsCrossed(1_800, OFF)).toBe(1);
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

describe('os botões da folha', () => {
  it('parado segundo a placa: ligar em destaque, desligar discreto mas presente, e a linha honesta', () => {
    expect(spindleButtons({ on: false, spinningUp: false, pending: null })).toEqual({
      start: true,
      stop: 'secondary',
      idleNote: 'A placa não está mandando o spindle girar.',
    });
  });

  it('ligado segundo a placa, mesmo com 0 rpm reportado (S0 com M3): desligar em destaque', () => {
    expect(spindleButtons({ on: true, spinningUp: false, pending: null })).toMatchObject({ stop: 'primary', idleNote: null });
  });

  it('girando: desligar em destaque, sem ligar', () => {
    expect(spindleButtons({ on: true, spinningUp: false, pending: null })).toEqual({ start: false, stop: 'primary', idleNote: null });
  });

  it('acelerando depois de segurar: desligar em destaque, mesmo antes da placa confirmar', () => {
    expect(spindleButtons({ on: false, spinningUp: true, pending: 'Ligando…' })).toMatchObject({ start: false, stop: 'primary' });
  });

  it('com um comando pendente, a linha honesta espera', () => {
    expect(spindleButtons({ on: false, spinningUp: false, pending: 'Desligando…' }).idleNote).toBeNull();
  });
});
