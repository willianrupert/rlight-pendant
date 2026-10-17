import { describe, expect, it } from 'vitest';
import { applyReport, parseStatus, profileFromConfig, type MachineSnapshot } from '@rlight/core';
import configDump from '../../core/test/fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import { DEFAULT_MOTION, planCommand, type CommandContext } from '../src/commands';
import { ControlSession, REASON_TAKEN } from '../src/control';
import { parseClientMessage } from '../src/messages';

const profile = profileFromConfig(configDump);
const snap = (line: string): MachineSnapshot => applyReport(null, parseStatus(line)!);
const idleAt = (x: number, y: number, z: number) => snap(`<Idle|MPos:${x},${y},${z}|FS:0,0>`);

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  snapshot: idleAt(100, 200, -10),
  profile,
  link: 'live',
  inControl: true,
  homed: true,
  commanded: {},
  motion: DEFAULT_MOTION,
  ...over,
});

describe('planCommand: a policy vem antes de tudo', () => {
  it('sem sinal, nada sai, com o motivo', () => {
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ link: 'no-signal' }))).toEqual({
      ok: false,
      reason: 'Sem sinal da máquina',
    });
  });

  it('quem só assiste não comanda', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ inControl: false }));
    expect(p).toEqual({ ok: false, reason: 'Outra tela está no controle' });
  });

  it('em alarme, só desbloquear, homing e reset', () => {
    const alarm = snap('<Alarm|MPos:0,0,0|FS:0,0>');
    expect(planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ snapshot: alarm })).ok).toBe(false);
    expect(planCommand({ command: 'unlock' }, ctx({ snapshot: alarm }))).toMatchObject({
      ok: true,
      writes: [{ line: '$X' }],
    });
  });

  it('ir até o fantasma exige homing', () => {
    const p = planCommand({ command: 'jogTo', x: 10, y: 10 }, ctx({ homed: false }));
    expect(p).toEqual({ ok: false, reason: 'Faça o homing para mover pelo mapa' });
  });

  it('sem perfil da placa, nada se move', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 1 }, ctx({ profile: null }));
    expect(p).toEqual({ ok: false, reason: 'Lendo a configuração da máquina' });
  });
});

describe('planCommand: movimento absoluto (ADR-0002)', () => {
  it('a régua sai como jog absoluto a partir da posição reportada', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx());
    expect(p).toEqual({
      ok: true,
      writes: [{ line: '$J=G53 G90 X100.500 F1000' }],
      commanded: { x: 100.5 },
      hitLimit: false,
      moves: true,
    });
  });

  it('o alvo comandado acumula: o comando leva o alvo, não o incremento', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx({ commanded: { x: 101 } }));
    expect(p).toMatchObject({ writes: [{ line: '$J=G53 G90 X101.500 F1000' }], commanded: { x: 101.5 } });
  });

  it('mais de 2 mm à frente da máquina, a régua pesa', () => {
    const p = planCommand({ command: 'nudge', axis: 'x', delta: 0.5 }, ctx({ commanded: { x: 102 } }));
    expect(p).toEqual({ ok: false, reason: 'A régua está à frente da máquina' });
  });

  it('o curso da placa recorta o destino', () => {
    const p = planCommand({ command: 'nudge', axis: 'z', delta: 1 }, ctx({ snapshot: idleAt(0, 0, -0.4) }));
    expect(p).toMatchObject({ ok: true, writes: [{ line: '$J=G53 G90 Z0.000 F1000' }], hitLimit: true });
  });

  it('já na parede, nada a mandar', () => {
    const p = planCommand({ command: 'nudge', axis: 'z', delta: 1 }, ctx({ snapshot: idleAt(0, 0, 0) }));
    expect(p).toMatchObject({ ok: true, writes: [], hitLimit: true, moves: false });
  });

  it('o fantasma é recortado pelo curso e usa o avanço do ADR-0002', () => {
    const p = planCommand({ command: 'jogTo', x: 5000, y: 300 }, ctx());
    expect(p).toMatchObject({
      ok: true,
      writes: [{ line: '$J=G53 G90 X1215.000 Y300.000 F2000' }],
      hitLimit: true,
      commanded: { x: 1215, y: 300 },
    });
  });

  it('o avanço nunca passa do máximo do eixo', () => {
    const p = planCommand({ command: 'jogTo', x: 10, y: 10 }, ctx({ motion: { ...DEFAULT_MOTION, jogToFeedMmPerMin: 9000 } }));
    expect(p).toMatchObject({ writes: [{ line: '$J=G53 G90 X10.000 Y10.000 F3000' }] });
  });

  it('parar manda 0x85 e o alvo volta a seguir a posição real', () => {
    const jog = snap('<Jog|MPos:100,200,-10|FS:1000,0>');
    const p = planCommand({ command: 'cancelJog' }, ctx({ snapshot: jog, commanded: { x: 101 } }));
    expect(p).toMatchObject({ ok: true, writes: [{ realtime: 0x85 }], commanded: {} });
  });
});

describe('ControlSession: uma tela comanda', () => {
  it('assumir é explícito e devolve quem tinha o controle', () => {
    const s = new ControlSession();
    expect(s.controller).toBeNull();
    expect(s.take('a')).toEqual({ previous: null });
    expect(s.take('b')).toEqual({ previous: 'a' });
    expect(s.isController('b')).toBe(true);
    expect(s.isController('a')).toBe(false);
    expect(REASON_TAKEN).toBeTruthy();
  });

  it('só quem tem o controle pode largá-lo', () => {
    const s = new ControlSession();
    s.take('a');
    expect(s.release('b')).toBe(false);
    expect(s.release('a')).toBe(true);
    expect(s.controller).toBeNull();
  });
});

describe('parseClientMessage', () => {
  it('aceita as mensagens do protocolo', () => {
    expect(parseClientMessage('{"type":"takeControl"}')).toEqual({ type: 'takeControl' });
    expect(parseClientMessage('{"type":"command","id":"1","command":"nudge","axis":"x","delta":0.1}')).toEqual({
      type: 'command',
      id: '1',
      command: 'nudge',
      axis: 'x',
      delta: 0.1,
    });
    expect(parseClientMessage('{"type":"command","command":"cancelJog"}')).toEqual({
      type: 'command',
      command: 'cancelJog',
    });
  });

  it('recusa o que não entende, com o motivo', () => {
    expect(parseClientMessage('não é json')).toEqual({ invalid: 'JSON inválido' });
    expect(parseClientMessage('{"type":"command","command":"nudge","axis":"a","delta":1}')).toEqual({
      invalid: 'Eixo inválido',
    });
    expect(parseClientMessage('{"type":"command","command":"jogTo","x":"1","y":2}')).toEqual({
      invalid: 'Destino inválido',
    });
    expect(parseClientMessage('{"type":"command","command":"spindleOn"}')).toEqual({
      invalid: 'Comando desconhecido: spindleOn',
    });
  });
});
