import { describe, expect, it } from 'vitest';
import { pitchFor } from './feel';

// O clique da régua afina com a velocidade, como uma catraca girando mais depressa.
describe('pitchFor', () => {
  it('devagar: o clique de sempre', () => {
    expect(pitchFor(0)).toBe(1);
    expect(pitchFor(4)).toBe(1);
  });

  it('mais rápido, mais agudo, sem virar um chiado', () => {
    expect(pitchFor(12)).toBeGreaterThan(1);
    expect(pitchFor(12)).toBeLessThan(pitchFor(24));
    expect(pitchFor(200)).toBe(1.5);
  });
});
