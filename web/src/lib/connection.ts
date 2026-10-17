// A tela como cliente do servidor (server/PROTOCOL.md). Reconecta sozinha e
// combina os dois trechos num indicador só (ADR-0007): celular → servidor, pela
// idade da última mensagem que chegou aqui, e servidor → máquina, pelo que o
// servidor diz.

import {
  combineLinks,
  initialLink,
  onReport,
  viewLink,
  type Axis,
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

/** Os comandos que a tela manda (server/PROTOCOL.md, incluindo os da v1). */
export type CommandRequest =
  | { command: 'nudge'; axis: Axis; delta: number }
  | { command: 'jogTo'; x: number; y: number }
  | { command: 'jogAxisTo'; axis: Axis; value: number }
  | { command: 'zero'; axis: Axis | 'all' }
  | { command: 'spindleOn' | 'spindleSpeed'; rpm: number }
  | { command: 'cancelJog' | 'unlock' | 'home' | 'softReset' | 'feedHold' | 'resume' | 'undoZero' | 'spindleOff' };

export type CommandName = CommandRequest['command'];

export type CommandResult =
  | { ok: true; hitLimit?: boolean | undefined; undoable?: boolean | undefined }
  | { ok: false; reason: string };

type ServerMessage =
  | { type: 'welcome'; protocol: number; clientId: string }
  | { type: 'profile'; profile: MachineProfile; limits: MachineLimits }
  | ({ type: 'state' } & ServerState)
  | { type: 'alarm'; code: number }
  | { type: 'control'; inControl: boolean; reason?: string }
  | { type: 'result'; id?: string; ok: boolean; reason?: string; hitLimit?: boolean; undoable?: boolean }
  | { type: 'invalid'; reason?: string };

const BACKOFF_MS = [500, 1_000, 2_000, 5_000];

export class Connection {
  state: ServerState | null = null;
  profile: MachineProfile | null = null;
  limits: MachineLimits = {};
  alarmCode: number | null = null;

  onState: ((s: ServerState, receivedAt: number) => void) | null = null;
  onProfile: ((p: MachineProfile) => void) | null = null;
  /** Ganhou ou perdeu o controle; `reason` quando outra tela tirou. */
  onControl: ((inControl: boolean, reason: string | null) => void) | null = null;
  /** Resposta a um comando, pelo id que `command` devolveu. */
  onResult: ((id: string, command: CommandName, result: CommandResult) => void) | null = null;
  /** O servidor fechou: os comandos sem resposta não vão ter resposta. */
  onClose: (() => void) | null = null;

  #seq = 0;
  /** Pedidos sem resposta, em ordem de envio (o servidor responde em ordem). */
  #waiting: { id: string; command: CommandName }[] = [];

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

  get open(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  takeControl(): boolean {
    return this.#send({ type: 'takeControl' });
  }

  releaseControl(): boolean {
    return this.#send({ type: 'releaseControl' });
  }

  /**
   * Manda um comando e devolve o id que volta no `result`, ou null se o
   * servidor não está ao alcance. Nada fica guardado para depois (ADR-0007).
   */
  command(req: CommandRequest): string | null {
    const id = `r${++this.#seq}`;
    if (!this.#send({ type: 'command', id, ...req })) return null;
    this.#waiting.push({ id, command: req.command });
    if (this.#waiting.length > 64) this.#waiting.shift();
    return id;
  }

  #send(msg: object): boolean {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }

  #resolve(id: string | undefined, result: CommandResult): void {
    // Sem id (um `invalid`), a resposta é do pedido mais antigo ainda sem resposta.
    const k = id === undefined ? 0 : this.#waiting.findIndex((w) => w.id === id);
    const w = k >= 0 ? this.#waiting[k] : undefined;
    if (!w) return;
    this.#waiting.splice(k, 1);
    this.onResult?.(w.id, w.command, result);
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
      } else if (msg.type === 'control') {
        const c = msg as { inControl: boolean; reason?: string };
        this.onControl?.(c.inControl, c.reason ?? null);
      } else if (msg.type === 'result') {
        const r = msg as { id?: string; ok: boolean; reason?: string; hitLimit?: boolean; undoable?: boolean };
        this.#resolve(
          r.id,
          r.ok ? { ok: true, hitLimit: r.hitLimit, undoable: r.undoable } : { ok: false, reason: r.reason ?? 'A máquina recusou' },
        );
      } else if (msg.type === 'invalid') {
        // Um comando que este servidor ainda não conhece: o motivo vem como texto.
        this.#resolve(undefined, { ok: false, reason: (msg as { reason?: string }).reason ?? 'O servidor não entendeu' });
      }
    };
    ws.onclose = () => {
      this.#ws = null;
      const lost = this.#waiting;
      this.#waiting = [];
      for (const w of lost) this.onResult?.(w.id, w.command, { ok: false, reason: 'Sem sinal do servidor' });
      this.onClose?.();
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
