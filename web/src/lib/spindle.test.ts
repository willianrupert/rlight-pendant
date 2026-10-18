import { describe, expect, it } from 'vitest';
import { DIAL_SWEEP_DEG, OFF, OFF_DEG, angleFromRpm, dialAngle, rampMs, releaseAction, ringFill, spindleStatus, spinupOver, rpmFromAngle, snapRpm, spindleButtons, thousandsCrossed } from './spindle';

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

describe('a rampa do inversor', () => {
  // Rampa de aceleração constante: o perfil diz o tempo de 0 ao máximo (P100 = 5 s até 18000 rpm).
  it('rotações baixas chegam antes', () => {
    expect(rampMs(4_800, 18_000, 5_000)).toBeCloseTo(1_333, 0);
    expect(rampMs(18_000, 18_000, 5_000)).toBe(5_000);
    expect(rampMs(24_000, 18_000, 5_000)).toBe(5_000);
    expect(rampMs(4_800, 18_000, 0)).toBe(0);
  });
});

describe('o anel', () => {
  const base = { spinupMs: 5_000, maxRpm: 18_000, targetRpm: 9_000, range: { min: 900, max: 18_000 }, runningRpm: 0 };
  const at = (rpm: number) => angleFromRpm(rpm, base.range) / DIAL_SWEEP_DEG;

  it('segurar enche só o trecho do desligado', () => {
    const r = ringFill({ ...base, holdProgress: 0.5, spinupStartedAt: null, now: 0, running: false });
    expect(r.phase).toBe('confirming');
    expect(r.fill).toBeCloseTo((OFF_DEG / DIAL_SWEEP_DEG) * 0.5, 5);
  });

  it('acelerando, o anel acompanha a rotação estimada pela rampa, até a escolhida', () => {
    const mid = ringFill({ ...base, holdProgress: 1, spinupStartedAt: 0, now: 1_250, running: false }); // 18000/5000 × 1250 = 4500
    expect(mid.phase).toBe('spinup');
    expect(mid.estimatedRpm).toBe(4_500);
    expect(mid.fill).toBeCloseTo(at(4_500), 5);
    const done = ringFill({ ...base, holdProgress: 1, spinupStartedAt: 0, now: 2_600, running: true });
    expect(done.phase).toBe('running');
    expect(done.fill).toBeCloseTo(at(9_000), 5);
  });

  it('girando, o anel mostra a rotação que a placa reporta', () => {
    expect(ringFill({ ...base, runningRpm: 12_000, holdProgress: 0, spinupStartedAt: null, now: 0, running: true }).fill).toBeCloseTo(at(12_000), 5);
  });

  it('sem estimativa no perfil, chega direto', () => {
    expect(ringFill({ ...base, spinupMs: 0, holdProgress: 1, spinupStartedAt: 0, now: 0, running: false }).phase).toBe('running');
  });
});

describe('o fim do spin-up estimado', () => {
  // Visto na máquina: ligou a 3.100, trocou para 5.100, e o anel parou nos 3.100,
  // preso à estimativa do primeiro arranque.
  it('a placa confirmou e a rampa acabou: o anel passa a seguir a rotação reportada', () => {
    expect(spinupOver({ running: true, phase: 'running', target: 3_100, spinupTarget: 3_100 })).toBe(true);
  });

  it('trocou a rotação no meio: a estimativa do arranque não vale mais', () => {
    expect(spinupOver({ running: true, phase: 'spinup', target: 5_100, spinupTarget: 3_100 })).toBe(true);
  });

  it('ainda acelerando, ou a placa sem confirmar: a estimativa continua', () => {
    expect(spinupOver({ running: true, phase: 'spinup', target: 3_100, spinupTarget: 3_100 })).toBe(false);
    expect(spinupOver({ running: false, phase: 'running', target: 3_100, spinupTarget: 3_100 })).toBe(false);
  });
});

describe('a linha de estado do mostrador', () => {
  it('acelerando: a estimativa, dita como estimativa', () => {
    expect(spindleStatus({ phase: 'spinup', estimatedRpm: 2_300, on: false, started: true, reported: 0 })).toBe('Acelerando · ~2.300 rpm');
  });

  it('a rampa acabou mas a placa ainda não confirmou: "Ligando…", nunca "Parado" com o motor girando', () => {
    // Visto na máquina: o A: do relatório chega a cada ~10 relatórios, e por ~2 s a folha dizia "Parado".
    expect(spindleStatus({ phase: 'running', estimatedRpm: 900, on: false, started: true, reported: 0 })).toBe('Ligando…');
  });

  it('ligado pela placa, com a rotação reportada quando houver', () => {
    expect(spindleStatus({ phase: 'running', estimatedRpm: 0, on: true, started: false, reported: 900 })).toBe('Ligado · 900 rpm');
    expect(spindleStatus({ phase: 'running', estimatedRpm: 0, on: true, started: false, reported: 0 })).toBe('Ligado');
  });

  it('trocando a rotação: diz de onde para onde, até a placa reportar a nova', () => {
    // Visto na máquina: a folha mostrava a rotação antiga por 6 a 8 s depois da troca.
    expect(spindleStatus({ phase: 'running', estimatedRpm: 0, on: true, started: false, reported: 6_900, adjustingTo: 6_000 })).toBe('Ajustando · 6.900 → 6.000 rpm');
    expect(spindleStatus({ phase: 'running', estimatedRpm: 0, on: true, started: false, reported: 6_000, adjustingTo: 6_000 })).toBe('Ligado · 6.000 rpm');
  });

  it('sem pedido e sem a placa dizer que gira: parado', () => {
    expect(spindleStatus({ phase: 'idle', estimatedRpm: 0, on: false, started: false, reported: 0 })).toBe('Parado');
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

  it('com o dedo ainda no ligar, nada muda de lugar: o Desligar não pode surgir debaixo do dedo', () => {
    // Na máquina real: o Desligar crescia para onde estava o ligar e soltar o dedo virava um toque nele (M5).
    expect(spindleButtons({ on: true, spinningUp: true, pending: null, holding: true })).toMatchObject({ start: true, stop: 'secondary' });
  });

  it('com um comando pendente, a linha honesta espera', () => {
    expect(spindleButtons({ on: false, spinningUp: false, pending: 'Desligando…' }).idleNote).toBeNull();
  });
});
