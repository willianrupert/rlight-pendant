import { describe, expect, it } from 'vitest';
import type { MachineSnapshot, MachineState } from '@rlight/core';
import { PendingTracker, UndoWindow, UNDO_WINDOW_MS, canTakeControl, controlsVisible, machineActions } from './control';

const live = { link: 'live' as const, inControl: true, homed: true, canHome: true };
const names = (state: MachineState, ctx = live) => machineActions(state, ctx).map((a) => a.label);

const snap = (state: MachineState, spindle = 0): MachineSnapshot => ({
  state,
  subState: null,
  mpos: { x: 0, y: 0, z: 0 },
  wpos: null,
  wco: null,
  feed: 0,
  spindle,
  overrides: null,
  sd: null,
  pins: '',
});

describe('quem vê os controles', () => {
  it('só com sinal e com o controle', () => {
    expect(controlsVisible({ live: true, inControl: true, hasMachine: true })).toBe(true);
    expect(controlsVisible({ live: false, inControl: true, hasMachine: true })).toBe(false);
    expect(controlsVisible({ live: true, inControl: false, hasMachine: true })).toBe(false);
  });

  it('assumir aparece só sem o controle e com sinal', () => {
    expect(canTakeControl({ live: true, inControl: false, hasMachine: true })).toBe(true);
    expect(canTakeControl({ live: false, inControl: false, hasMachine: true })).toBe(false);
    expect(canTakeControl({ live: true, inControl: true, hasMachine: true })).toBe(false);
  });
});

describe('botões por estado (a policy do core decide)', () => {
  it('alarme: desbloquear, homing e resetar', () => {
    expect(names('Alarm')).toEqual(['Desbloquear', 'Homing', 'Resetar']);
  });

  it('em repouso só o homing, e discreto se já houve homing', () => {
    expect(names('Idle')).toEqual(['Homing']);
    expect(machineActions('Idle', live)[0]!.primary).toBe(false);
    expect(machineActions('Idle', { ...live, homed: false })[0]!.primary).toBe(true);
  });

  it('máquina sem homing não oferece homing', () => {
    expect(names('Alarm', { ...live, canHome: false })).toEqual(['Desbloquear', 'Resetar']);
  });

  it('movendo: parar primeiro; cortando: pausar; em pausa: retomar', () => {
    expect(names('Jog')).toEqual(['Parar', 'Pausar']);
    expect(names('Run')).toEqual(['Pausar', 'Resetar']);
    expect(names('Hold')).toEqual(['Retomar', 'Resetar']);
  });

  it('homing e resetar se confirmam segurando', () => {
    const a = machineActions('Alarm', live);
    expect(a.filter((x) => x.hold).map((x) => x.command)).toEqual(['home', 'softReset']);
  });

  it('nunca um botão de emergência (ADR-0005)', () => {
    for (const s of ['Idle', 'Jog', 'Run', 'Hold', 'Alarm', 'Home', 'Door', 'Check', 'Sleep'] as const) {
      expect(names(s).join(' ')).not.toMatch(/emerg/i);
    }
  });

  it('sem sinal ou sem controle, nenhum botão', () => {
    expect(names('Alarm', { ...live, link: 'no-signal' as never })).toEqual([]);
    expect(names('Alarm', { ...live, inControl: false })).toEqual([]);
  });
});

describe('pendente até a máquina confirmar', () => {
  it('o result aceita, o estado confirma', () => {
    const p = new PendingTracker();
    p.sent('r1', 'unlock', 0, 'Alarm');
    expect(p.has('unlock')).toBe(true);
    expect(p.result('r1', { ok: true })).toBeNull();
    expect(p.state(snap('Alarm'))).toEqual([]);
    expect(p.state(snap('Idle'))).toEqual([{ kind: 'confirmed', command: 'unlock' }]);
    expect(p.has('unlock')).toBe(false);
  });

  it('a recusa traz o motivo do servidor', () => {
    const p = new PendingTracker();
    p.sent('r2', 'spindleOn', 0, 'Idle');
    expect(p.result('r2', { ok: false, reason: 'Esta máquina não tem spindle configurado' })).toEqual({
      kind: 'failed',
      command: 'spindleOn',
      reason: 'Esta máquina não tem spindle configurado',
    });
    expect(p.has('spindleOn')).toBe(false);
  });

  it('o estado não confirma antes do result', () => {
    const p = new PendingTracker();
    p.sent('r3', 'feedHold', 0, 'Run');
    expect(p.state(snap('Hold'))).toEqual([]);
  });

  it('sem resposta, vira aviso no prazo', () => {
    const p = new PendingTracker();
    p.sent('r4', 'home', 0, 'Alarm');
    expect(p.expire(1_000)).toEqual([]);
    expect(p.expire(6_000)).toEqual([{ kind: 'failed', command: 'home', reason: 'O servidor não respondeu' }]);
  });

  it('homing rápido demais para ser visto confirma pelo "agora tem homing"', () => {
    const p = new PendingTracker();
    p.sent('r6', 'home', 0, 'Alarm', false);
    p.result('r6', { ok: true });
    expect(p.state(snap('Idle'), false)).toEqual([]);
    expect(p.state(snap('Idle'), true)).toEqual([{ kind: 'confirmed', command: 'home' }]);
  });

  it('spindle confirma pela rotação reportada', () => {
    const p = new PendingTracker();
    p.sent('r5', 'spindleOn', 0, 'Idle');
    p.result('r5', { ok: true });
    expect(p.state(snap('Idle', 0))).toEqual([]);
    expect(p.state(snap('Idle', 12000))).toEqual([{ kind: 'confirmed', command: 'spindleOn' }]);
  });
});

describe('desfazer o zero', () => {
  it('vale 30 s e uma vez só', () => {
    const u = new UndoWindow();
    u.open('X zerado', 1_000);
    expect(u.active(1_000 + UNDO_WINDOW_MS - 1)).toBe('X zerado');
    expect(u.take(2_000)).toBe(true);
    expect(u.take(2_001)).toBe(false);
    expect(u.active(2_001)).toBeNull();
  });

  it('expira sozinho', () => {
    const u = new UndoWindow();
    u.open('Tudo zerado', 0);
    expect(u.active(UNDO_WINDOW_MS)).toBeNull();
    expect(u.take(UNDO_WINDOW_MS + 1)).toBe(false);
  });
});
