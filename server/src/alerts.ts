// Quando o servidor avisa o celular (Web Push): só o que precisa de alguém na
// máquina. O app no iPhone não roda fechado; quem vê a máquina o tempo todo é o
// servidor, então é ele que decide e manda. Normal não vira aviso, e o mesmo
// aviso não se repete em rajada.

import { alarmCause, type MachineState } from '@rlight/core';

/** O spindle girando com a máquina parada por este tempo: provavelmente esquecido. */
export const SPINDLE_IDLE_MS = 10 * 60_000;
/** Sem sinal por este tempo, ocupada (spindle ligado ou em movimento): avisa. */
export const LOST_BUSY_MS = 30_000;
/** O mesmo tipo de aviso não sai de novo antes disto. */
export const ALERT_COOLDOWN_MS = 60_000;

export type AlertKind = 'alarm' | 'spindleIdle' | 'lost' | 'test';

export interface Alert {
  kind: AlertKind;
  title: string;
  body: string;
  /** O número no ícone do app; 0 apaga. */
  badge: number;
}

/** O que o servidor vê da máquina a cada instante. */
export interface Seen {
  live: boolean;
  state: MachineState | null;
  spindleOn: boolean;
}

const MOVING = new Set<MachineState>(['Run', 'Jog', 'Home', 'Hold']);

export const TEST_ALERT: Alert = {
  kind: 'test',
  title: 'Avisos ligados',
  body: 'Este aparelho vai receber os alarmes da CNC.',
  badge: 0,
};

export class AlertWatcher {
  /** Desde quando o spindle gira com a máquina parada; null se não está assim. */
  #idleSince: number | null = null;
  #idleWarned = false;
  /** Como a máquina estava na última leitura ao vivo. */
  #lastLive: { spindleOn: boolean; moving: boolean } | null = null;
  #lostSince: number | null = null;
  #lostWarned = false;
  readonly #sentAt = new Map<AlertKind, number>();

  /** Um ALARM:n da placa. */
  onAlarm(code: number, now: number): Alert | null {
    return this.#gate({ kind: 'alarm', title: 'Alarme na CNC', body: alarmCause(code), badge: 1 }, now);
  }

  /** Uma olhada na máquina (a cada batida do servidor). */
  observe(seen: Seen, now: number): Alert[] {
    const out: Alert[] = [];
    if (seen.live) {
      this.#lostSince = null;
      this.#lostWarned = false;
      this.#lastLive = { spindleOn: seen.spindleOn, moving: seen.state !== null && MOVING.has(seen.state) };
      const idling = seen.spindleOn && seen.state === 'Idle';
      if (!idling) {
        this.#idleSince = null;
        // Só desligar o spindle libera o aviso de novo; um movimento só recomeça a conta.
        if (!seen.spindleOn) this.#idleWarned = false;
      } else {
        this.#idleSince ??= now;
        if (!this.#idleWarned && now - this.#idleSince >= SPINDLE_IDLE_MS) {
          this.#idleWarned = true;
          const a = this.#gate(
            { kind: 'spindleIdle', title: 'Spindle ligado e parado', body: 'Está girando há 10 min sem a máquina se mover.', badge: 1 },
            now,
          );
          if (a) out.push(a);
        }
      }
      return out;
    }
    this.#idleSince = null;
    const last = this.#lastLive;
    if (!last || !(last.spindleOn || last.moving)) return out;
    this.#lostSince ??= now;
    if (!this.#lostWarned && now - this.#lostSince >= LOST_BUSY_MS) {
      this.#lostWarned = true;
      const body = last.spindleOn ? 'O sinal caiu com o spindle ligado.' : 'O sinal caiu no meio de um movimento.';
      const a = this.#gate({ kind: 'lost', title: 'A CNC saiu do ar', body, badge: 1 }, now);
      if (a) out.push(a);
    }
    return out;
  }

  #gate(alert: Alert, now: number): Alert | null {
    const last = this.#sentAt.get(alert.kind);
    if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return null;
    this.#sentAt.set(alert.kind, now);
    return alert;
  }
}
