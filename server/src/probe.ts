// A placa de toque do Z (PRODUCT v1, tela de Automações). Como o "Zerar fresa" do
// Romney no Mach3 (descida curta e lenta, o zero pela espessura da placa), com a
// sequência segura: desce rápido até encostar, recua, mede de novo devagar e zera
// o Z pela coordenada que a placa reportou no toque (G10 L2), sem o pequeno
// atraso de parada do G38.2. Cada fase só sai depois do [PRB:…:1] da anterior; se
// a fresa não encosta, a placa entra em alarme e nada mais é mandado.
//
// Puro: quem chama manda as linhas e repassa os toques e alarmes da placa.

import type { Vec3 } from '@rlight/core';

export const PROBE = {
  /** O quanto desce, no máximo, na busca rápida (o Romney usava 12 mm). */
  seekMm: 15,
  seekFeed: 200,
  /** Depois do primeiro toque, recua isto e mede de novo. */
  backoffMm: 1.5,
  /** A medição lenta vai até isto abaixo do primeiro toque. */
  measureBelowMm: 1,
  measureFeed: 25,
  /** No fim, a fresa fica isto acima da placa. */
  clearanceMm: 5,
};

export type ProbeStatus = 'seeking' | 'measuring' | 'done' | 'failed';

export interface ProbeStep {
  status: ProbeStatus;
  lines: string[];
  reason?: string;
  /** No fim: o zero da peça em Z, em coordenada de máquina. */
  zeroMachineZ?: number;
}

export interface ProbeStart {
  /** Posição de máquina do Z agora. */
  mposZ: number;
  /** O offset da peça em Z agora (work = máquina − wco). */
  wcoZ: number;
  zMin: number;
  zMax: number;
  /** A espessura da placa de toque, em mm. */
  thicknessMm: number;
}

const mm = (v: number) => (Object.is(Math.round(v * 1000) / 1000, -0) ? 0 : Math.round(v * 1000) / 1000).toFixed(3);

export class ProbeSequence {
  status: ProbeStatus = 'seeking';

  constructor(private readonly o: ProbeStart) {}

  /** A busca rápida, limitada pelo fundo do curso. */
  start(): ProbeStep {
    const target = Math.max(this.o.zMin, this.o.mposZ - PROBE.seekMm);
    this.status = 'seeking';
    return { status: 'seeking', lines: [`G90 G38.2 Z${mm(target - this.o.wcoZ)} F${PROBE.seekFeed}`] };
  }

  /** Um [PRB:…] da placa. */
  onProbe(at: Vec3, touched: boolean): ProbeStep {
    if (!touched) return this.#fail('A fresa não encostou na placa. Aproxime mais e tente de novo.');
    if (this.status === 'seeking') {
      this.status = 'measuring';
      const back = Math.min(this.o.zMax, at.z + PROBE.backoffMm);
      const target = Math.max(this.o.zMin, at.z - PROBE.measureBelowMm);
      return { status: 'measuring', lines: [`G53 G0 Z${mm(back)}`, `G90 G38.2 Z${mm(target - this.o.wcoZ)} F${PROBE.measureFeed}`] };
    }
    if (this.status === 'measuring') {
      this.status = 'done';
      const zero = at.z - this.o.thicknessMm;
      return {
        status: 'done',
        lines: [`G10 L2 P0 Z${mm(zero)}`, `G53 G0 Z${mm(Math.min(this.o.zMax, at.z + PROBE.clearanceMm))}`],
        zeroMachineZ: Math.round(zero * 1000) / 1000,
      };
    }
    return { status: this.status, lines: [] };
  }

  /** Um alarme da placa no meio da sequência. */
  onAlarm(code: number): ProbeStep {
    if (code === 4) return this.#fail('A placa já estava encostando na fresa. Afaste e tente de novo.');
    if (code === 5) return this.#fail('A fresa não encostou na placa. Aproxime mais e tente de novo.');
    return this.#fail('A máquina entrou em alarme durante a medição.');
  }

  #fail(reason: string): ProbeStep {
    this.status = 'failed';
    return { status: 'failed', lines: [], reason };
  }
}
