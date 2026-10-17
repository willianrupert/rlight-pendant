import { describe, expect, it } from 'vitest';
import { HOLD_MS, holdProgress, idleHold, pressHold, releaseHold } from './hold';
import { NudgeBatcher } from './nudges';

describe('segurar para confirmar', () => {
  it('não dispara antes do tempo e dispara uma vez só', () => {
    let h = pressHold(idleHold(), 0);
    expect(holdProgress(h, HOLD_MS / 2)).toMatchObject({ progress: 0.5, fire: false });
    const r = holdProgress(h, HOLD_MS);
    expect(r.fire).toBe(true);
    h = r.next;
    expect(holdProgress(h, HOLD_MS + 100).fire).toBe(false);
  });

  it('soltar antes cancela', () => {
    expect(holdProgress(releaseHold(), 5_000)).toMatchObject({ progress: 0, fire: false });
  });
});

describe('nudges em lotes de 50 ms', () => {
  it('junta traços e manda delta = traços × passo', () => {
    const b = new NudgeBatcher('x', 0.1);
    b.add(3, 0);
    b.add(-1, 20);
    expect(b.flush(30)).toBeNull();
    expect(b.flush(50)).toEqual({ command: 'nudge', axis: 'x', delta: 0.2 });
    expect(b.flush(200)).toBeNull();
  });

  it('traços que se anulam não viram comando', () => {
    const b = new NudgeBatcher('z', 0.01);
    b.add(2, 0);
    b.add(-2, 10);
    expect(b.flush(60)).toBeNull();
  });

  it('descartar esquece o pendente', () => {
    const b = new NudgeBatcher('y', 1);
    b.add(5, 0);
    b.discard();
    expect(b.flush(100, true)).toBeNull();
  });
});
