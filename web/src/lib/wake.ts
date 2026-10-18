// A tela fica acesa enquanto esta tela tem o controle (Screen Wake Lock). No
// iPhone, apagar a tela no meio de um ajuste incomodava e suspendia a aba, uma
// das causas de perder o controle. O sistema solta a trava quando a aba some;
// ao voltar, ela é pedida de novo. Sem suporte, nada acontece.

interface Lock {
  release(): Promise<void>;
}
interface Nav {
  wakeLock?: { request(type: 'screen'): Promise<Lock> };
}
interface Doc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
}

export class ScreenAwake {
  #wanted = false;
  #lock: Lock | null = null;
  #asking = false;

  constructor(
    private readonly nav: Nav = navigator as unknown as Nav,
    private readonly doc: Doc = document,
  ) {
    doc.addEventListener('visibilitychange', () => {
      // A trava some com a aba escondida; ao voltar, pede outra se ainda faz sentido.
      if (doc.visibilityState !== 'visible') this.#lock = null;
      else if (this.#wanted) void this.#acquire();
    });
  }

  set(wanted: boolean): void {
    this.#wanted = wanted;
    if (wanted) void this.#acquire();
    else void this.#release();
  }

  async #acquire(): Promise<void> {
    if (this.#lock || this.#asking || !this.nav.wakeLock || this.doc.visibilityState !== 'visible') return;
    this.#asking = true;
    try {
      const lock = await this.nav.wakeLock.request('screen');
      if (this.#wanted) this.#lock = lock;
      else await lock.release();
    } catch {
      // Recusado (bateria fraca, modo de economia): a tela apaga como sempre.
    } finally {
      this.#asking = false;
    }
  }

  async #release(): Promise<void> {
    const lock = this.#lock;
    this.#lock = null;
    try {
      await lock?.release();
    } catch {
      /* já solta */
    }
  }
}
