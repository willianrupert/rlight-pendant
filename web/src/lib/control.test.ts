import { describe, expect, it } from 'vitest';
import type { MachineSnapshot, MachineState } from '@rlight/core';
import { PendingTracker, UndoWindow, UNDO_WINDOW_MS, barSlots, canTakeControl, controlsVisible } from './control';

const live = { link: 'live' as const, inControl: true, homed: true, canHome: true };

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

describe('a barra de ações: três lugares fixos', () => {
  const ctx = { ...live, hasSpindle: true };
  const view = (state: MachineState, c = ctx) =>
    barSlots(state, c).map((x) => (x === null ? '—' : x.kind === 'action' ? x.label : x.kind));

  it('cada estado em seus lugares', () => {
    expect(view('Idle')).toEqual(['spindle', 'Homing', 'zeroAll']);
    expect(view('Jog')).toEqual(['spindle', 'Parar', '—']);
    expect(view('Run')).toEqual(['spindle', 'Pausar', 'Resetar']);
    expect(view('Hold')).toEqual(['spindle', 'Retomar', 'Resetar']);
    expect(view('Alarm')).toEqual(['Homing', 'Desbloquear', 'Resetar']);
  });

  it('durante o homing, Resetar fica no meio', () => {
    expect(view('Home')).toEqual(['—', 'Resetar', '—']);
  });

  it('a ação do meio é a principal; em repouso, o homing só quando falta', () => {
    expect(barSlots('Alarm', ctx)[1]).toMatchObject({ command: 'unlock', tone: 'primary' });
    expect(barSlots('Idle', ctx)[1]).toMatchObject({ command: 'home', tone: 'normal' });
    expect(barSlots('Idle', { ...ctx, homed: false })[1]).toMatchObject({ command: 'home', tone: 'primary' });
  });

  it('homing e resetar se confirmam segurando; resetar é perigoso', () => {
    expect(barSlots('Alarm', ctx)[0]).toMatchObject({ command: 'home', hold: true });
    expect(barSlots('Alarm', ctx)[2]).toMatchObject({ command: 'softReset', hold: true, tone: 'danger' });
  });

  it('máquina sem homing nem spindle: os lugares ficam vazios, não somem', () => {
    const none = { ...ctx, canHome: false, hasSpindle: false };
    expect(view('Alarm', none)).toEqual(['—', 'Desbloquear', 'Resetar']);
    expect(view('Idle', none)).toEqual(['—', '—', 'zeroAll']);
  });

  it('nunca um botão de emergência (ADR-0005)', () => {
    for (const s of ['Idle', 'Jog', 'Run', 'Hold', 'Alarm', 'Home', 'Door', 'Check', 'Sleep'] as const) {
      expect(view(s).join(' ')).not.toMatch(/emerg/i);
    }
  });

  it('sem sinal ou sem controle, nenhuma ação', () => {
    expect(view('Alarm', { ...ctx, link: 'no-signal' as never })).toEqual(['—', '—', '—']);
    expect(view('Alarm', { ...ctx, inControl: false })).toEqual(['—', '—', '—']);
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
