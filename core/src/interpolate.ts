// Fluidez sem mentir (ADR-0009): a tela desenha a posição um relatório atrás,
// deslizando entre os dois últimos relatórios reais. Nada é previsto.

export interface Report {
  /** Instante em que o relatório chegou. */
  readonly at: number;
  readonly value: number;
}

/**
 * O valor a desenhar no instante `now`, com `delayMs` de atraso fixo (um
 * intervalo de relatório). Além do último relatório, segura o último: nunca
 * extrapola. Os relatórios devem estar em ordem de chegada.
 */
export function displayValue(reports: readonly Report[], now: number, delayMs: number): number | null {
  const first = reports[0];
  if (!first) return null;
  const t = now - delayMs;
  if (t <= first.at) return first.value;
  for (let k = 1; k < reports.length; k++) {
    const b = reports[k]!;
    if (t <= b.at) {
      const a = reports[k - 1]!;
      const span = b.at - a.at;
      if (span <= 0) return b.value;
      return a.value + (b.value - a.value) * ((t - a.at) / span);
    }
  }
  return reports[reports.length - 1]!.value;
}

/** Os relatórios recentes de um valor, em ordem, sem os que chegam atrasados. */
export class ReportBuffer {
  #items: Report[] = [];

  constructor(private readonly capacity = 16) {}

  get items(): readonly Report[] {
    return this.#items;
  }

  push(report: Report): void {
    const last = this.#items[this.#items.length - 1];
    if (last && report.at <= last.at) return;
    this.#items.push(report);
    if (this.#items.length > this.capacity) this.#items.shift();
  }

  /** Numa reconexão, o passado não serve para interpolar o presente. */
  clear(): void {
    this.#items = [];
  }
}
