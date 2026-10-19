import { describe, expect, it } from 'vitest';
import { RELAUNCH_AFTER_MS, reloadOnReturn } from './shell';

describe('reloadOnReturn: versão nova só na próxima abertura', () => {
  it('sem versão nova, nunca', () => {
    expect(reloadOnReturn(false, 60 * 60_000)).toBe(false);
  });

  it('numa troca rápida de app, não interrompe', () => {
    expect(reloadOnReturn(true, 2_000)).toBe(false);
  });

  it('depois de um tempo fora, a volta conta como abrir de novo', () => {
    expect(reloadOnReturn(true, RELAUNCH_AFTER_MS)).toBe(true);
  });
});
