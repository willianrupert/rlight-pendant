import { describe, expect, it } from 'vitest';
import { ENTER_MOVING_MS, LEAVE_MOVING_MS, Presence } from './presence';

describe('histerese da apresentação', () => {
  it('um nudge curto não troca a tela', () => {
    const p = new Presence();
    expect(p.update('Idle', 0)).toBe('Idle');
    expect(p.update('Jog', 100)).toBe('Idle');
    expect(p.update('Jog', 500)).toBe('Idle');
    expect(p.update('Idle', 600)).toBe('Idle');
  });

  it('nudges em sequência, com repousos curtos entre eles, não piscam', () => {
    const p = new Presence();
    p.update('Idle', 0);
    let t = 0;
    for (let k = 0; k < 10; k++) {
      expect(p.update('Jog', (t += 100))).toBe('Idle');
      expect(p.update('Jog', (t += 400))).toBe('Idle');
      expect(p.update('Idle', (t += 100))).toBe('Idle');
    }
  });

  it('um movimento que dura vira "movendo"', () => {
    const p = new Presence();
    p.update('Idle', 0);
    p.update('Jog', 1_000);
    expect(p.update('Jog', 1_000 + ENTER_MOVING_MS - 1)).toBe('Idle');
    expect(p.update('Jog', 1_000 + ENTER_MOVING_MS)).toBe('Jog');
  });

  it('só volta ao repouso depois de um repouso que dura', () => {
    const p = new Presence();
    p.update('Idle', 0);
    p.update('Jog', 10);
    p.update('Jog', 10 + ENTER_MOVING_MS);
    expect(p.update('Idle', 2_000)).toBe('Jog');
    expect(p.update('Jog', 2_200)).toBe('Jog');
    expect(p.update('Idle', 2_300)).toBe('Jog');
    expect(p.update('Idle', 2_300 + LEAVE_MOVING_MS)).toBe('Idle');
  });

  it('alarme, pausa e homing aparecem na hora', () => {
    const p = new Presence();
    p.update('Idle', 0);
    expect(p.update('Alarm', 10)).toBe('Alarm');
    expect(p.update('Home', 20)).toBe('Home');
    expect(p.update('Idle', 30)).toBe('Idle');
    p.update('Jog', 40);
    expect(p.update('Hold', 50)).toBe('Hold');
  });
});
