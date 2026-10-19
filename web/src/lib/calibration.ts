// A calibração guiada da rotação (tela de Automações). A curva do speed_map
// costuma vir medida em volts no borne da placa, não em rotação de verdade; nas
// pontas, ela erra (na máquina de referência, 900 rpm pedidos giravam a ~1.104).
// O app liga o spindle em algumas rotações, quem opera digita a frequência que o
// inversor mostra, e cada leitura vira um ponto verdadeiro: "esta rotação real sai
// deste PWM". O speed_map novo é feito desses pontos. Puro.

export interface SpeedPoint {
  rpm: number;
  percent: number;
}

export interface Reading {
  commandedRpm: number;
  hz: number;
}

/** O PWM que a placa gera para uma rotação pedida: interpolação linear do speed_map, como o FluidNC. */
export function percentFor(map: SpeedPoint[], rpm: number): number {
  const m = [...map].sort((a, b) => a.rpm - b.rpm);
  if (!m.length) return 0;
  if (rpm <= m[0]!.rpm) return m[0]!.percent;
  for (let i = 1; i < m.length; i++) {
    const a = m[i - 1]!;
    const b = m[i]!;
    if (rpm <= b.rpm) return a.percent + ((rpm - a.rpm) / (b.rpm - a.rpm)) * (b.percent - a.percent);
  }
  return m[m.length - 1]!.percent;
}

const STEPS = [900, 1200, 1800, 3000, 4500, 9000, 13500, 18000];

/** As rotações a medir, dentro da faixa do spindle: mais pontos embaixo, onde a curva erra mais. */
export function calibrationSteps(s: { minRunningRpm: number; maxRpm: number }): number[] {
  const inside = STEPS.filter((r) => r >= s.minRunningRpm && r < s.maxRpm);
  return [...inside, s.maxRpm];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A curva verdadeira: cada leitura dá a rotação real (Hz × rpm por Hz) do PWM que
 * a rotação pedida gerou. Começa em 0=0%. Uma leitura que faria a curva voltar
 * (mais PWM, menos rotação) é descartada: um engano de leitura não pode inverter
 * o spindle.
 */
export function fitSpeedMap(oldMap: SpeedPoint[], readings: Reading[], rpmPerHz: number): SpeedPoint[] {
  const points = readings
    .filter((r) => r.hz > 0)
    .map((r) => ({ rpm: Math.round(r.hz * rpmPerHz), percent: r2(percentFor(oldMap, r.commandedRpm)) }))
    .sort((a, b) => a.percent - b.percent);
  const out: SpeedPoint[] = [{ rpm: 0, percent: 0 }];
  for (const p of points) {
    const last = out[out.length - 1]!;
    if (p.rpm > last.rpm && p.percent > last.percent) out.push(p);
  }
  return out;
}

/** A linha para o bloco do spindle no config.yaml do FluidNC. */
export function formatSpeedMap(map: SpeedPoint[]): string {
  return `speed_map: ${map.map((p) => `${p.rpm}=${p.percent.toFixed(2)}%`).join(' ')}`;
}
