// Histerese da apresentação. Cada nudge da régua é um jog de meio segundo, e a
// tela trocava de modo a cada um: fundo, título e ações piscavam várias vezes
// por segundo. Aqui a tela só passa a "movendo" se o movimento dura, e só volta
// ao repouso depois de um repouso que dura. A policy e os comandos continuam
// usando o estado real; isto é só o que a tela mostra.

import type { MachineState } from '@rlight/core';

/** Um movimento precisa durar isto para a tela mudar para "movendo". */
export const ENTER_MOVING_MS = 700;
/** O repouso precisa durar isto para a tela voltar a "em repouso". */
export const LEAVE_MOVING_MS = 600;

const QUIET: readonly MachineState[] = ['Idle', 'Jog'];

export class Presence {
  #shown: MachineState | null = null;
  #raw: MachineState | null = null;
  #rawSince = 0;

  /** O estado que a tela mostra agora. Chamar a cada estado novo e a cada tique do relógio. */
  update(raw: MachineState | null, now: number): MachineState | null {
    if (raw !== this.#raw) {
      this.#raw = raw;
      this.#rawSince = now;
    }
    const shown = this.#shown;
    // Só a troca entre repouso e movimento manual tem histerese. Alarme, pausa,
    // homing e o resto aparecem na hora: o anormal nunca espera.
    if (raw === null || shown === null || !QUIET.includes(raw) || !QUIET.includes(shown)) {
      this.#shown = raw;
      return raw;
    }
    if (raw === shown) return shown;
    const held = now - this.#rawSince;
    if (raw === 'Jog' && held >= ENTER_MOVING_MS) this.#shown = 'Jog';
    else if (raw === 'Idle' && held >= LEAVE_MOVING_MS) this.#shown = 'Idle';
    return this.#shown;
  }

  get shown(): MachineState | null {
    return this.#shown;
  }
}
