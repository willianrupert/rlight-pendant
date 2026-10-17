// A sessão de controle (ADR-0001): uma tela comanda, as outras assistem.
// Assumir é explícito, e quem perde o controle fica sabendo por quê.
//
// Uma queda curta não tira o controle de ninguém (ADR-0007): o iPhone suspende a
// aba ao apagar a tela, o Wi-Fi pisca, o servidor reinicia numa publicação. Cada
// tela assume com um token só dela; ao cair, o controle fica reservado para esse
// token por um tempo, e só a mesma tela o retoma. Enquanto isso ninguém comanda,
// e outra tela ainda pode assumir de propósito. Soltar de propósito solta de vez.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const REASON_TAKEN = 'Outra tela assumiu o controle';

/** Quanto tempo o controle espera pela tela que caiu. */
export const CONTROL_GRACE_MS = 60_000;

export class ControlSession {
  private holder: { clientId: string; token: string | undefined } | null = null;
  private reserved: { token: string; until: number } | null = null;

  constructor(private readonly graceMs = CONTROL_GRACE_MS) {}

  get controller(): string | null {
    return this.holder?.clientId ?? null;
  }

  /** O token de quem tem o controle ou a reserva, para guardar entre reinícios. */
  get token(): string | null {
    return this.holder?.token ?? this.reserved?.token ?? null;
  }

  isController(clientId: string): boolean {
    return this.holder?.clientId === clientId;
  }

  /** Alguém tem o controle, ou ele está guardado para a tela que caiu. */
  controlled(now: number): boolean {
    return this.holder !== null || (this.reserved !== null && now < this.reserved.until);
  }

  /** Assume o controle. Devolve quem o tinha antes, para ser avisado. */
  take(clientId: string, token?: string): { previous: string | null } {
    const previous = this.holder && this.holder.clientId !== clientId ? this.holder.clientId : null;
    this.holder = { clientId, token };
    this.reserved = null;
    return { previous };
  }

  /**
   * A mesma tela, numa conexão nova, retoma o controle: da reserva, ou da conexão
   * velha que o servidor ainda não viu cair. Devolve a conexão velha, se havia.
   */
  resume(clientId: string, token: string, now: number): boolean {
    if (this.holder?.token === token) {
      this.holder = { clientId, token };
      return true;
    }
    if (!this.holder && this.reserved?.token === token && now < this.reserved.until) {
      this.holder = { clientId, token };
      this.reserved = null;
      return true;
    }
    return false;
  }

  /** A conexão caiu: com token, o controle fica reservado; sem, solta na hora. */
  drop(clientId: string, now: number): void {
    if (this.holder?.clientId !== clientId) return;
    if (this.holder.token) this.reserved = { token: this.holder.token, until: now + this.graceMs };
    this.holder = null;
  }

  /** Reserva vinda de antes de um reinício do servidor. */
  reserve(token: string, now: number): void {
    if (!this.holder) this.reserved = { token, until: now + this.graceMs };
  }

  /** Larga o controle de propósito, se for dele: sem reserva. */
  release(clientId: string): boolean {
    if (this.holder?.clientId !== clientId) return false;
    this.holder = null;
    this.reserved = null;
    return true;
  }
}

/** Onde guardar o token do controle, para um reinício do servidor não tirá-lo de ninguém. */
export interface ControlMemory {
  read(): string | null;
  write(token: string | null): void;
}

export const noControlMemory: ControlMemory = { read: () => null, write: () => {} };

export function fileControlMemory(path: string): ControlMemory {
  return {
    read() {
      try {
        const t = (JSON.parse(readFileSync(path, 'utf8')) as { token?: unknown }).token;
        return typeof t === 'string' && t !== '' ? t : null;
      } catch {
        return null;
      }
    },
    write(token) {
      try {
        if (token === null) rmSync(path, { force: true });
        else {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify({ token }) + '\n', { mode: 0o600 });
        }
      } catch {
        // Sem onde gravar: um reinício solta o controle, como antes.
      }
    },
  };
}
