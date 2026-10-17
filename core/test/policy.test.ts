import { describe, expect, it } from 'vitest';
import { COMMANDS, MACHINE_STATES, allowed, type Command, type MachineState } from '../src/policy';

// ADR-0005: a interface só oferece o que o estado permite. Uma célula por teste.

const ctx = { link: 'live', inControl: true, homed: true } as const;

// O que cada estado permite, com conexão viva e controle nas mãos.
const TABLE: Record<MachineState, readonly Command[]> = {
  Idle: ['home', 'softReset', 'jogTo', 'jogAxisTo', 'nudge', 'zero', 'undoZero', 'spindleOn', 'spindleOff', 'spindleSpeed', 'probeZ'],
  Jog: ['softReset', 'feedHold', 'cancelJog', 'jogTo', 'jogAxisTo', 'nudge'],
  Run: ['softReset', 'feedHold', 'spindleSpeed'],
  Hold: ['softReset', 'resume', 'spindleOff'],
  Alarm: ['unlock', 'home', 'softReset'],
  Home: ['softReset'],
  Door: ['softReset'],
  Check: ['softReset'],
  Sleep: ['softReset'],
};

describe('tabela estado × comando', () => {
  for (const state of MACHINE_STATES) {
    for (const command of COMMANDS) {
      const expected = TABLE[state].includes(command);
      it(`${state} · ${command} → ${expected ? 'permitido' : 'bloqueado'}`, () => {
        expect(allowed(command, state, ctx).ok).toBe(expected);
      });
    }
  }
});

describe('regras que valem para todos os estados', () => {
  it('sem sinal, nada é permitido, nem resetar', () => {
    for (const state of MACHINE_STATES) {
      for (const command of COMMANDS) {
        expect(allowed(command, state, { ...ctx, link: 'no-signal' })).toEqual({
          ok: false,
          reason: 'Sem sinal da máquina',
        });
      }
    }
  });

  it('quem só assiste não comanda nada', () => {
    const r = allowed('zero', 'Idle', { ...ctx, inControl: false });
    expect(r).toEqual({ ok: false, reason: 'Outra tela está no controle' });
  });

  it('sem homing não existe fantasma, mas a régua continua', () => {
    expect(allowed('jogTo', 'Idle', { ...ctx, homed: false })).toEqual({
      ok: false,
      reason: 'Faça o homing para mover pelo mapa',
    });
    expect(allowed('nudge', 'Idle', { ...ctx, homed: false }).ok).toBe(true);
  });

  it('o destino absoluto da régua também exige homing', () => {
    expect(allowed('jogAxisTo', 'Idle', { ...ctx, homed: false })).toEqual({
      ok: false,
      reason: 'Faça o homing para mover até um ponto',
    });
  });
});

describe('motivos que a interface mostra', () => {
  it('em corte, zerar explica por quê', () => {
    expect(allowed('zero', 'Run', ctx)).toEqual({ ok: false, reason: 'Não durante um corte' });
  });

  it('em alarme, mover explica por quê', () => {
    expect(allowed('nudge', 'Alarm', ctx)).toEqual({ ok: false, reason: 'Desbloqueie a máquina primeiro' });
  });

  it('permitido não traz motivo', () => {
    expect(allowed('home', 'Idle', ctx)).toEqual({ ok: true });
  });
});
