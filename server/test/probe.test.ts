import { describe, expect, it } from 'vitest';
import { ProbeSequence } from '../src/probe';

// A placa de toque (PRODUCT v1): desce rápido até encostar, recua, mede de novo
// devagar e zera o Z pela coordenada do toque. Cada fase só começa depois que a
// placa confirma o toque anterior.

const at = (z: number) => ({ x: 100, y: 200, z });
// Z de máquina de −158 a 0; a peça com o zero em −20 (wco.z = −20).
const base = { mposZ: -30, wcoZ: -20, zMin: -158, zMax: 0, thicknessMm: 10 };

describe('ProbeSequence', () => {
  it('começa descendo no máximo 15 mm, rápido, em coordenada da peça', () => {
    // Alvo de máquina −45 → da peça −25 (−45 − (−20)).
    expect(new ProbeSequence(base).start()).toEqual({ status: 'seeking', lines: ['G90 G38.2 Z-25.000 F200'] });
  });

  it('nunca desce além do fundo do curso', () => {
    const s = new ProbeSequence({ ...base, mposZ: -150 });
    expect(s.start().lines).toEqual(['G90 G38.2 Z-138.000 F200']); // máquina −158
  });

  it('encostou: recua 1,5 mm e mede de novo devagar', () => {
    const s = new ProbeSequence(base);
    s.start();
    // Toque em −40,2 de máquina: recua a −38,7; mede até −41,2 de máquina (peça −21,2).
    expect(s.onProbe(at(-40.2), true)).toEqual({ status: 'measuring', lines: ['G53 G0 Z-38.700', 'G90 G38.2 Z-21.200 F25'] });
  });

  it('mediu: zera o Z pela coordenada do toque (espessura da placa) e sobe 5 mm', () => {
    const s = new ProbeSequence(base);
    s.start();
    s.onProbe(at(-40.2), true);
    // Toque fino em −40,25: o zero da peça fica 10 mm abaixo, wco.z = −50,25.
    expect(s.onProbe(at(-40.25), true)).toEqual({
      status: 'done',
      lines: ['G10 L2 P0 Z-50.250', 'G53 G0 Z-35.250'],
      zeroMachineZ: -50.25,
    });
  });

  it('não encostou: falha, sem mandar mais nada', () => {
    const s = new ProbeSequence(base);
    s.start();
    expect(s.onProbe(at(-45), false)).toEqual({ status: 'failed', lines: [], reason: 'A fresa não encostou na placa. Aproxime mais e tente de novo.' });
  });

  it('a placa já estava encostando (alarme 4): falha com o motivo', () => {
    const s = new ProbeSequence(base);
    s.start();
    expect(s.onAlarm(4)).toEqual({ status: 'failed', lines: [], reason: 'A placa já estava encostando na fresa. Afaste e tente de novo.' });
  });
});
