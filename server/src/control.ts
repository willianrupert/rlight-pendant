// A sessão de controle (ADR-0001): uma tela comanda, as outras assistem.
// Assumir é explícito, e quem perde o controle fica sabendo por quê.

export const REASON_TAKEN = 'Outra tela assumiu o controle';

export class ControlSession {
  private holder: string | null = null;

  get controller(): string | null {
    return this.holder;
  }

  isController(clientId: string): boolean {
    return this.holder === clientId;
  }

  /** Assume o controle. Devolve quem o tinha antes, para ser avisado. */
  take(clientId: string): { previous: string | null } {
    const previous = this.holder === clientId ? null : this.holder;
    this.holder = clientId;
    return { previous };
  }

  /** Larga o controle, se for dele. Também vale para quem desconectou. */
  release(clientId: string): boolean {
    if (this.holder !== clientId) return false;
    this.holder = null;
    return true;
  }
}
