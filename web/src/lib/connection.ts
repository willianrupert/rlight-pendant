// A tela como cliente do servidor (server/PROTOCOL.md). Reconecta sozinha e
// combina os dois trechos num indicador só (ADR-0007): celular → servidor, pela
// idade da última mensagem que chegou aqui, e servidor → máquina, pelo que o
// servidor diz.

import {
  combineLinks,
  initialLink,
  onReport,
  viewLink,
  type AxisValues,
  type CombinedLink,
  type LinkState,
  type MachineLimits,
  type MachineProfile,
  type MachineSnapshot,
} from '@rlight/core';

export interface ServerState {
  machine: MachineSnapshot | null;
  link: CombinedLink;
  commanded: AxisValues;
  homed: boolean;
  control: { inControl: boolean; controlled: boolean };
}

type ServerMessage =
  | { type: 'welcome'; protocol: number; clientId: string }
  | { type: 'profile'; profile: MachineProfile; limits: MachineLimits }
  | ({ type: 'state' } & ServerState)
  | { type: 'alarm'; code: number }
  | { type: string };

const BACKOFF_MS = [500, 1_000, 2_000, 5_000];

export class Connection {
  state: ServerState | null = null;
  profile: MachineProfile | null = null;
  limits: MachineLimits = {};
  alarmCode: number | null = null;

  onState: ((s: ServerState, receivedAt: number) => void) | null = null;
  onProfile: ((p: MachineProfile) => void) | null = null;

  #ws: WebSocket | null = null;
  #toServer: LinkState = initialLink();
  #attempt = 0;
  #stopped = false;

  constructor(private readonly url: string) {}

  start(): void {
    this.#stopped = false;
    this.#open();
  }

  stop(): void {
    this.#stopped = true;
    this.#ws?.close();
  }

  /** O estado de conexão que a tela mostra, agora. */
  link(now: number): CombinedLink {
    const server = viewLink(this.#toServer, now);
    const machine = this.state?.link ?? { mode: 'no-signal' as const, ageMs: null, showBack: false };
    return combineLinks({ server, machine: { mode: machine.mode, ageMs: machine.ageMs, showBack: machine.showBack } });
  }

  #open(): void {
    const ws = new WebSocket(this.url);
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
    };
    ws.onmessage = (e) => {
      const now = performance.now();
      this.#toServer = onReport(this.#toServer, now);
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'state') {
        const s = msg as ServerState & { type: 'state' };
        this.state = s;
        if (s.machine?.state !== 'Alarm') this.alarmCode = null;
        this.onState?.(s, now);
      } else if (msg.type === 'profile') {
        const p = msg as { profile: MachineProfile; limits: MachineLimits };
        this.profile = p.profile;
        this.limits = p.limits;
        this.onProfile?.(p.profile);
      } else if (msg.type === 'alarm') {
        this.alarmCode = (msg as { code: number }).code;
      }
    };
    ws.onclose = () => {
      this.#ws = null;
      if (this.#stopped) return;
      const wait = BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!;
      this.#attempt++;
      setTimeout(() => this.#open(), wait);
    };
    ws.onerror = () => ws.close();
  }
}

/** O servidor mora no mesmo endereço da página, em /ws (proxy em dev, Nginx no Proxmox). */
export function serverUrl(loc: Location = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}
