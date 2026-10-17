import { describe, expect, it } from 'vitest';
import { ControlSession } from '../src/control';

// A sessão de controle sobrevive a uma queda curta: a mesma tela volta com o
// controle, ninguém mais herda por acaso, e soltar de propósito solta de vez.

const GRACE = 60_000;

describe('ControlSession: voltar depois de uma queda', () => {
  it('a mesma tela, na conexão nova, retoma o controle dentro da janela', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    s.drop('c1', 1_000);
    expect(s.isController('c1')).toBe(false);
    expect(s.controlled(2_000)).toBe(true); // reservado: as outras telas veem "outra tela no controle"
    expect(s.resume('c2', 'tok-a', 30_000)).toBe(true);
    expect(s.isController('c2')).toBe(true);
  });

  it('depois da janela, a reserva some', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    s.drop('c1', 0);
    expect(s.controlled(GRACE + 1)).toBe(false);
    expect(s.resume('c2', 'tok-a', GRACE + 1)).toBe(false);
  });

  it('outro token não retoma', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    s.drop('c1', 0);
    expect(s.resume('c2', 'tok-b', 10)).toBe(false);
  });

  it('a tela reconecta antes de o servidor notar a queda: troca para a conexão nova', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    expect(s.resume('c2', 'tok-a', 10)).toBe(true);
    expect(s.isController('c2')).toBe(true);
    s.drop('c1', 20); // a conexão velha cai depois: não leva nada
    expect(s.isController('c2')).toBe(true);
  });

  it('soltar de propósito não deixa reserva', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    s.release('c1');
    expect(s.controlled(1)).toBe(false);
    expect(s.resume('c2', 'tok-a', 1)).toBe(false);
  });

  it('outra tela pode assumir durante a reserva, e a reserva acaba', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', 'tok-a');
    s.drop('c1', 0);
    s.take('c3', 'tok-c');
    expect(s.resume('c2', 'tok-a', 20)).toBe(false);
    expect(s.isController('c3')).toBe(true);
  });

  it('sem token (cliente antigo), cair solta na hora, como antes', () => {
    const s = new ControlSession(GRACE);
    s.take('c1', undefined);
    s.drop('c1', 0);
    expect(s.controlled(1)).toBe(false);
  });

  it('reserva restaurada de um reinício do servidor', () => {
    const s = new ControlSession(GRACE);
    s.reserve('tok-a', 5_000);
    expect(s.controlled(5_000 + GRACE - 1)).toBe(true);
    expect(s.resume('c9', 'tok-a', 6_000)).toBe(true);
  });
});
