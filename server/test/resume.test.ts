import { describe, expect, it } from 'vitest';
import { RESUME_OFFER_MS, ResumeTracker } from '../src/resume';

// Retomar de onde parou: a última posição parada com o homing valendo; quando o
// homing se perde (desligou, alarme) e volta, oferece voltar para lá.

const at = (x: number, y: number, z: number) => ({ x, y, z });

describe('ResumeTracker', () => {
  it('desligou e religou: depois do homing, oferece voltar para onde estava', () => {
    const r = new ResumeTracker(null);
    r.onStill(at(412.3, 118.05, -20), 1_000);
    r.homingLost();
    expect(r.homingRegained(at(0, 0, 0), 60_000)).toEqual(at(412.3, 118.05, -20));
    expect(r.offer(61_000)).toEqual({ pos: at(412.3, 118.05, -20), at: 60_000 });
  });

  it('a posição salva antes de o servidor reiniciar também vale', () => {
    const r = new ResumeTracker({ pos: at(100, 200, -5), at: 0 });
    r.homingLost();
    expect(r.homingRegained(at(0, 0, 0), 10_000)).toEqual(at(100, 200, -5));
  });

  it('o homing de volta já no mesmo lugar: nada a oferecer', () => {
    const r = new ResumeTracker(null);
    r.onStill(at(0.2, 0.3, 0), 1_000);
    r.homingLost();
    expect(r.homingRegained(at(0, 0, 0), 2_000)).toBeNull();
  });

  it('sem perder o homing (só o Wi-Fi caiu), nada a oferecer', () => {
    const r = new ResumeTracker(null);
    r.onStill(at(100, 100, -5), 1_000);
    expect(r.homingRegained(at(0, 0, 0), 2_000)).toBeNull();
  });

  it('a oferta vale por um tempo, e sai ao ser usada ou dispensada', () => {
    const r = new ResumeTracker(null);
    r.onStill(at(100, 100, -5), 0);
    r.homingLost();
    r.homingRegained(at(0, 0, 0), 1_000);
    expect(r.offer(1_000 + RESUME_OFFER_MS + 1)).toBeNull();
    r.homingLost();
    r.onStill(at(100, 100, -5), 2_000); // o homing já se perdeu: não muda a lembrança
    r.homingRegained(at(0, 0, 0), 3_000);
    r.clearOffer();
    expect(r.offer(3_001)).toBeNull();
  });

  it('diz quando a lembrança mudou, para gravar só então', () => {
    const r = new ResumeTracker(null);
    expect(r.onStill(at(1, 1, 1), 0)).toBe(true);
    expect(r.onStill(at(1, 1, 1), 100)).toBe(false);
    expect(r.still).toEqual({ pos: at(1, 1, 1), at: 0 });
  });
});
