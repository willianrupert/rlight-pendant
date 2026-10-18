import { describe, expect, it } from 'vitest';
import { ScreenAwake } from './wake';

// A tela não apaga enquanto esta tela tem o controle: apagar no meio do ajuste
// era um incômodo e uma das causas de perder o controle (a aba suspensa).

function fakes(supported = true) {
  const log: string[] = [];
  let visible = true;
  const listeners: (() => void)[] = [];
  const nav = supported
    ? {
        wakeLock: {
          request: async () => {
            log.push('request');
            return { release: async () => void log.push('release') };
          },
        },
      }
    : {};
  const doc = {
    get visibilityState() {
      return visible ? 'visible' : 'hidden';
    },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  const setVisible = (v: boolean) => {
    visible = v;
    for (const fn of listeners) fn();
  };
  return { log, nav, doc, setVisible };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ScreenAwake', () => {
  it('pede a tela acesa ao assumir e solta ao devolver', async () => {
    const f = fakes();
    const w = new ScreenAwake(f.nav as never, f.doc as never);
    w.set(true);
    await tick();
    w.set(false);
    await tick();
    expect(f.log).toEqual(['request', 'release']);
  });

  it('o sistema solta ao esconder a aba; ao voltar, pede de novo', async () => {
    const f = fakes();
    const w = new ScreenAwake(f.nav as never, f.doc as never);
    w.set(true);
    await tick();
    f.setVisible(false);
    f.setVisible(true);
    await tick();
    expect(f.log).toEqual(['request', 'request']);
  });

  it('sem suporte no navegador, não faz nada e não quebra', async () => {
    const f = fakes(false);
    const w = new ScreenAwake(f.nav as never, f.doc as never);
    w.set(true);
    await tick();
    expect(f.log).toEqual([]);
  });

  it('pedir duas vezes seguidas não pede duas vezes', async () => {
    const f = fakes();
    const w = new ScreenAwake(f.nav as never, f.doc as never);
    w.set(true);
    w.set(true);
    await tick();
    expect(f.log).toEqual(['request']);
  });
});
