import { describe, expect, it } from 'vitest';
import { combineLinks, initialLink, onReport, viewLink } from '../src/link';

// ADR-0007: a tela mostra a última coisa que sabemos e há quanto tempo sabemos.
// Limiar de 2,5 s medido no spike S1: o Wi-Fi da placa tem pausas de até 1,6 s
// (reenvio do TCP) que não são quedas.

describe('viewLink', () => {
  it('nunca conectado é "sem sinal" e sem idade', () => {
    const v = viewLink(initialLink(), 5_000);
    expect(v.mode).toBe('no-signal');
    expect(v.ageMs).toBeNull();
  });

  it('é "ao vivo" enquanto o último relatório tem até 2,5 s', () => {
    const s = onReport(initialLink(), 1_000);
    expect(viewLink(s, 1_000).mode).toBe('live');
    expect(viewLink(s, 3_500).mode).toBe('live');
  });

  it('uma pausa real de reenvio do TCP (1,6 s, medida no S1) não vira "sem sinal"', () => {
    const s = onReport(initialLink(), 1_000);
    expect(viewLink(s, 2_567).mode).toBe('live');
  });

  it('vira "sem sinal" depois de 2,5 s sem relatório e informa a idade', () => {
    const s = onReport(initialLink(), 1_000);
    const v = viewLink(s, 5_200);
    expect(v.mode).toBe('no-signal');
    expect(v.ageMs).toBe(4_200);
  });

  it('o limite é configurável', () => {
    const s = onReport(initialLink(), 0);
    expect(viewLink(s, 400, { staleAfterMs: 300, backNoticeMs: 1_500 }).mode).toBe('no-signal');
  });
});

describe('aviso de "de volta"', () => {
  it('a primeira conexão não mostra "de volta"', () => {
    const s = onReport(initialLink(), 1_000);
    expect(viewLink(s, 1_100).showBack).toBe(false);
  });

  it('um relatório depois de uma queda mostra "de volta" por um instante', () => {
    let s = onReport(initialLink(), 1_000);
    s = onReport(s, 4_000); // 3 s sem nada: estava sem sinal
    expect(viewLink(s, 4_100).showBack).toBe(true);
    expect(viewLink(s, 4_000 + 1_500).showBack).toBe(false);
  });

  it('relatórios regulares não disparam "de volta"', () => {
    let s = onReport(initialLink(), 1_000);
    s = onReport(s, 1_100);
    s = onReport(s, 1_200);
    expect(viewLink(s, 1_250).showBack).toBe(false);
  });

  it('o aviso some na hora se o sinal cair de novo', () => {
    let s = onReport(initialLink(), 1_000);
    s = onReport(s, 4_000);
    expect(viewLink(s, 7_000).mode).toBe('no-signal');
    expect(viewLink(s, 7_000).showBack).toBe(false);
  });
});

describe('combineLinks: um indicador, não três', () => {
  const live = { mode: 'live', ageMs: 50, showBack: false } as const;
  const dead = { mode: 'no-signal', ageMs: 4_000, showBack: false } as const;

  it('só é ao vivo se os dois trechos estão ao vivo', () => {
    expect(combineLinks({ server: live, machine: live }).mode).toBe('live');
  });

  it('servidor fora: sem sinal, culpa do trecho celular → servidor', () => {
    const c = combineLinks({ server: dead, machine: live });
    expect(c.mode).toBe('no-signal');
    expect(c.failedHop).toBe('server');
  });

  it('placa fora: sem sinal, culpa do trecho servidor → máquina', () => {
    const c = combineLinks({ server: live, machine: dead });
    expect(c.failedHop).toBe('machine');
    expect(c.ageMs).toBe(4_000);
  });

  it('com o servidor fora, a idade mostrada é a do servidor', () => {
    const c = combineLinks({ server: { ...dead, ageMs: 7_000 }, machine: live });
    expect(c.ageMs).toBe(7_000);
  });
});
