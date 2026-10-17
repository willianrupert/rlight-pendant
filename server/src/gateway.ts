// O portão dos navegadores (ADR-0001): todos veem a máquina, um só comanda.
// Cada tela recebe o estado juntado e a conexão combinada, no máximo ~10 vezes
// por segundo. Todo comando passa pela policy antes de chegar à placa, e nada
// fica guardado para quando o sinal voltar (ADR-0007).

import { alarmKeepsHoming, noHomingMemory, type HomingMemory } from './homing-memory';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import { combineLinks, limitsOf, type AxisValues, type LinkView, type MachineState } from '@rlight/core';
import { pollHzFor, type Board } from './board';
import { DEFAULT_MOTION, planCommand, type MotionSettings, type ZeroMemory } from './commands';
import { ControlSession, noControlMemory, REASON_TAKEN, type ControlMemory } from './control';
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CommandRequest,
  type ServerMessage,
} from './messages';

export interface GatewayOptions {
  board: Board;
  port?: number;
  host?: string;
  motion?: MotionSettings;
  /** Teto de mensagens de estado por segundo, por tela. */
  maxStateHz?: number;
  /** De quanto em quanto tempo o estado sai mesmo sem relatório novo, para a idade andar. */
  heartbeatMs?: number;
  /** Onde guardar que o homing foi visto, para sobreviver a reinícios do servidor. */
  homingMemory?: HomingMemory;
  /** Onde guardar o token do controle, para um reinício não tirá-lo da tela. */
  controlMemory?: ControlMemory;
  /** Quanto tempo o controle espera pela tela que caiu. */
  controlGraceMs?: number;
}

/** Depois de um jog, quanto tempo a frequência fica alta e o alvo não é ressincronizado. */
const MOTION_GRACE_MS = 1_000;
const RESYNC_AFTER_MS = 300;

/** O trecho até o servidor, visto daqui, está sempre ao vivo; cada tela mede o seu. */
const SERVER_HOP: LinkView = { mode: 'live', ageMs: 0, showBack: false };

interface Client {
  id: string;
  ws: WebSocket;
  lastStateAt: number;
  timer: NodeJS.Timeout | null;
}

export class Gateway {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<string, Client>();
  private readonly control: ControlSession;
  private readonly controlMemory: ControlMemory;
  private nextId = 1;
  private commanded: AxisValues = {};
  private lastZero: ZeroMemory | null = null;
  /** A linha do último M3, enquanto a placa não responde a ela (a espera do spin-up). */
  private spinupLine: number | null = null;
  private lastJogAt = -Infinity;
  private sawHoming = false;
  private firstReport = true;
  private prevState: MachineState | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly board: Board;
  private readonly motion: MotionSettings;
  private readonly minStateIntervalMs: number;
  private readonly homingMemory: HomingMemory;

  constructor(private readonly options: GatewayOptions) {
    this.board = options.board;
    this.homingMemory = options.homingMemory ?? noHomingMemory;
    this.sawHoming = this.homingMemory.read();
    this.control = new ControlSession(options.controlGraceMs);
    this.controlMemory = options.controlMemory ?? noControlMemory;
    const saved = this.controlMemory.read();
    if (saved) this.control.reserve(saved, this.board.now());
    this.motion = options.motion ?? DEFAULT_MOTION;
    this.minStateIntervalMs = 1000 / (options.maxStateHz ?? 10);
  }

  async start(): Promise<number> {
    const b = this.board;
    this.unsubscribe.push(
      b.on('connected', () => {
        // Conexão nova: nada do que se mandou antes vale (ADR-0007).
        this.commanded = {};
        this.spinupLine = null;
        this.firstReport = true;
        this.prevState = null;
      }),
      b.on('disconnected', () => this.scheduleAll()),
      b.on('profile', () => this.broadcastProfile()),
      b.on('status', (snap) => this.onStatus(snap.state)),
      b.on('message', (m) => {
        if (m.kind !== 'alarm') return;
        this.commanded = {};
        if (!alarmKeepsHoming(m.code)) this.setHomed(false);
        this.broadcast({ type: 'alarm', code: m.code });
      }),
    );
    const wss = new WebSocketServer({ port: this.options.port ?? 0, host: this.options.host ?? '127.0.0.1' });
    this.wss = wss;
    wss.on('connection', (ws) => this.accept(ws));
    await new Promise<void>((resolve) => wss.once('listening', resolve));
    this.heartbeat = setInterval(() => this.scheduleAll(), this.options.heartbeatMs ?? 250);
    this.updatePoll();
    return (wss.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const off of this.unsubscribe) off();
    for (const c of this.clients.values()) {
      if (c.timer) clearTimeout(c.timer);
      c.ws.terminate();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => (this.wss ? this.wss.close(() => resolve()) : resolve()));
  }

  get viewers(): number {
    return this.clients.size;
  }

  // ── A placa ────────────────────────────────────────────────────────────────

  private setHomed(homed: boolean): void {
    if (homed === this.sawHoming) return;
    this.sawHoming = homed;
    this.homingMemory.write(homed);
  }

  private get homed(): boolean {
    const p = this.board.profile;
    if (!p) return false;
    return !p.canHome || this.sawHoming;
  }

  private onStatus(state: MachineState): void {
    const now = this.board.now();
    // Placa em alarme logo na conexão: pode ter reiniciado, e o homing se perdeu.
    if (this.firstReport && state === 'Alarm') this.setHomed(false);
    if (this.prevState === 'Home' && state !== 'Home' && state !== 'Alarm') this.setHomed(true);
    this.firstReport = false;
    this.prevState = state;
    // Parada, sem jog recente: o alvo volta a ser a posição real.
    if (state === 'Alarm' || (state === 'Idle' && now - this.lastJogAt > RESYNC_AFTER_MS)) this.commanded = {};
    this.updatePoll();
    this.scheduleAll();
  }

  private updatePoll(): void {
    const state = this.board.snapshot?.state;
    const moving =
      state === 'Jog' || state === 'Home' || this.board.now() - this.lastJogAt < MOTION_GRACE_MS;
    const running = state === 'Run' || state === 'Hold';
    this.board.setPollHz(pollHzFor({ viewers: this.clients.size, moving, running }));
  }

  // ── As telas ───────────────────────────────────────────────────────────────

  private accept(ws: WebSocket): void {
    const client: Client = { id: `c${this.nextId++}`, ws, lastStateAt: -Infinity, timer: null };
    this.clients.set(client.id, client);
    ws.on('message', (data) => this.onMessage(client, data.toString()));
    ws.on('close', () => this.drop(client));
    ws.on('error', () => {});
    this.send(client, { type: 'welcome', protocol: PROTOCOL_VERSION, clientId: client.id });
    this.sendProfile(client);
    this.schedule(client);
    this.updatePoll();
  }

  private drop(client: Client): void {
    if (client.timer) clearTimeout(client.timer);
    this.clients.delete(client.id);
    // Ninguém comanda por uma tela fechada; mas a mesma tela, voltando logo, retoma.
    this.control.drop(client.id, this.board.now());
    this.updatePoll();
    this.scheduleAll();
  }

  private onMessage(client: Client, raw: string): void {
    const msg = parseClientMessage(raw);
    if ('invalid' in msg) {
      this.send(client, { type: 'invalid', reason: msg.invalid });
      return;
    }
    this.handle(client, msg);
  }

  private handle(client: Client, msg: ClientMessage): void {
    if (msg.type === 'takeControl') {
      const { previous } = this.control.take(client.id, msg.token);
      const prev = previous ? this.clients.get(previous) : undefined;
      if (prev) this.send(prev, { type: 'control', inControl: false, reason: REASON_TAKEN });
      this.send(client, { type: 'control', inControl: true });
      this.controlMemory.write(this.control.token);
      this.scheduleAll();
      return;
    }
    if (msg.type === 'resumeControl') {
      const old = this.control.controller;
      const ok = this.control.resume(client.id, msg.token, this.board.now());
      // A conexão velha da mesma tela, se ainda aberta, deixa de comandar em silêncio.
      if (ok && old && old !== client.id) this.clients.get(old)?.ws.terminate();
      this.send(client, { type: 'control', inControl: ok });
      this.scheduleAll();
      return;
    }
    if (msg.type === 'releaseControl') {
      if (this.control.release(client.id)) this.send(client, { type: 'control', inControl: false });
      this.controlMemory.write(this.control.token);
      this.scheduleAll();
      return;
    }
    const { type: _type, id, ...req } = msg;
    this.runCommand(client, id, req as CommandRequest);
  }

  private runCommand(client: Client, id: string | undefined, req: CommandRequest): void {
    const ids = id === undefined ? {} : { id };
    const plan = planCommand(req, {
      snapshot: this.board.snapshot,
      profile: this.board.profile,
      link: this.board.view().mode,
      inControl: this.control.isController(client.id),
      homed: this.homed,
      commanded: this.commanded,
      motion: this.motion,
      now: this.board.now(),
      lastZero: this.lastZero,
      spindleDwelling: this.spinupLine !== null && !this.board.answered(this.spinupLine),
    });
    if (!plan.ok) {
      this.send(client, { type: 'result', ...ids, ok: false, reason: plan.reason });
      return;
    }
    for (const w of plan.writes) {
      const sent = 'line' in w ? this.board.send(w.line) : this.board.sendRealtime(w.realtime);
      if (!sent) {
        // A conexão caiu entre a decisão e o envio: recusa agora, não guarda.
        this.send(client, { type: 'result', ...ids, ok: false, reason: 'Sem sinal da máquina' });
        return;
      }
      if ('line' in w && /^M3\b/.test(w.line)) this.spinupLine = this.board.lastLine;
    }
    this.commanded = plan.commanded;
    if (plan.lastZero !== undefined) this.lastZero = plan.lastZero;
    if (plan.moves) this.lastJogAt = this.board.now();
    this.send(client, { type: 'result', ...ids, ok: true, ...(plan.hitLimit ? { hitLimit: true } : {}), ...(plan.undoable ? { undoable: true } : {}) });
    this.updatePoll();
    this.scheduleAll();
  }

  // ── Envio ──────────────────────────────────────────────────────────────────

  private send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients.values()) this.send(c, msg);
  }

  private sendProfile(client: Client): void {
    const profile = this.board.profile;
    if (profile) this.send(client, { type: 'profile', profile, limits: limitsOf(profile) });
  }

  private broadcastProfile(): void {
    for (const c of this.clients.values()) this.sendProfile(c);
  }

  private scheduleAll(): void {
    for (const c of this.clients.values()) this.schedule(c);
  }

  /** Estado novo sai agora, ou assim que o teto por tela permitir; nunca acumula. */
  private schedule(client: Client): void {
    if (client.timer) return;
    const wait = client.lastStateAt + this.minStateIntervalMs - this.board.now();
    if (wait <= 0) {
      this.sendState(client);
      return;
    }
    client.timer = setTimeout(() => {
      client.timer = null;
      this.sendState(client);
    }, wait);
  }

  private sendState(client: Client): void {
    if (!this.clients.has(client.id)) return;
    client.lastStateAt = this.board.now();
    this.send(client, {
      type: 'state',
      machine: this.board.snapshot,
      link: combineLinks({ server: SERVER_HOP, machine: this.board.view() }),
      commanded: this.commanded,
      homed: this.homed,
      control: { inControl: this.control.isController(client.id), controlled: this.control.controlled(this.board.now()) },
    });
  }
}
