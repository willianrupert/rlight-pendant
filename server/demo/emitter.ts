// O mínimo de EventEmitter que os canos em memória precisam: on, once, emit.

type Fn = (...args: any[]) => void;

export class Emitter {
  #on = new Map<string, Set<Fn>>();

  on(event: string, fn: Fn): this {
    let set = this.#on.get(event);
    if (!set) this.#on.set(event, (set = new Set()));
    set.add(fn);
    return this;
  }

  once(event: string, fn: Fn): this {
    const wrap: Fn = (...args) => {
      this.#on.get(event)?.delete(wrap);
      fn(...args);
    };
    return this.on(event, wrap);
  }

  protected emit(event: string, ...args: unknown[]): void {
    for (const fn of [...(this.#on.get(event) ?? [])]) fn(...args);
  }
}

/** Como um socket de verdade: nada acontece dentro da chamada que o provocou. */
export const later = (fn: () => void): void => queueMicrotask(fn);
