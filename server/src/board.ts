// A conexão com a placa (ADR-0001): uma só, permanente, pelo telnet do FluidNC.
// Pede o relatório na frequência que o servidor mandar, lê a configuração a cada
// conexão (ADR-0008) e, quando cai, tenta de novo para sempre (ADR-0007).

import net from 'node:net';
import {
  applyReport,
  DEFAULT_LINK_CONFIG,
  initialLink,
  onReport,
  parseLine,
  profileFromConfig,
  viewLink,
  type LinkConfig,
  type LinkState,
  type LinkView,
  type MachineProfile,
  type MachineSnapshot,
  type Message,
  type StatusReport,
} from '@rlight/core';

/** Intervalos entre tentativas: 0,5, 1, 2 e no máximo 5 s, para sempre (ADR-0007). */
export const DEFAULT_BACKOFF_MS: readonly number[] = [500, 1_000, 2_000, 5_000];

export const JOG_CANCEL = 0x85;
export const SOFT_RESET = 0x18;

export interface BoardOptions {
  host: string;
  port: number;
  backoffMs?: readonly number[];
  /**
   * Sem nenhuma linha da placa por isto, a conexão é dada como morta e refeita.
   * Bem acima das pausas de ~1,3 s vistas no S1, que não são queda.
   */
  deadAfterMs?: number;
  pollHz?: number;
  linkConfig?: LinkConfig;
  now?: () => number;
}

export interface BoardEvents {
  connected: () => void;
  disconnected: () => void;
  /** Um relatório de estado, já juntado ao que se sabia. */
  status: (snapshot: MachineSnapshot, report: StatusReport) => void;
  profile: (profile: MachineProfile) => void;
  /** Qualquer outra linha que a placa mandou (ok, error, ALARM, [MSG], ...). */
  message: (message: Message) => void;
  /** A placa recusou uma linha nossa: qual e o código do error. */
  lineError: (e: { line: string; code: number }) => void;
}

type Listeners = { [K in keyof BoardEvents]: Set<BoardEvents[K]> };

export class Board {
  snapshot: MachineSnapshot | null = null;
  profile: MachineProfile | null = null;
  /** Quantas vezes a conexão foi estabelecida. */
  sessions = 0;

  private link: LinkState = initialLink();
  private sock: net.Socket | null = null;
  private connected = false;
  private stopped = false;
  private attempt = 0;
  private buf = '';
  private lastLineAt = 0;
  /** Linhas do `$CD` enquanto chegam; null quando não há leitura em curso. */
  private configLines: string[] | null = null;
  private pollHz: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private readonly listeners: Listeners = {
    connected: new Set(),
    disconnected: new Set(),
    status: new Set(),
    profile: new Set(),
    message: new Set(),
    lineError: new Set(),
  };
  private readonly backoffMs: readonly number[];
  private readonly deadAfterMs: number;
  readonly linkConfig: LinkConfig;
  readonly now: () => number;

  constructor(private readonly options: BoardOptions) {
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.deadAfterMs = options.deadAfterMs ?? 5_000;
    this.pollHz = options.pollHz ?? 1;
    this.linkConfig = options.linkConfig ?? DEFAULT_LINK_CONFIG;
    this.now = options.now ?? Date.now;
  }

  on<K extends keyof BoardEvents>(event: K, fn: BoardEvents[K]): () => void {
    (this.listeners[event] as Set<BoardEvents[K]>).add(fn);
    return () => (this.listeners[event] as Set<BoardEvents[K]>).delete(fn);
  }

  private emit<K extends keyof BoardEvents>(event: K, ...args: Parameters<BoardEvents[K]>): void {
    for (const fn of this.listeners[event] as Set<(...a: Parameters<BoardEvents[K]>) => void>) fn(...args);
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.watchdog = setInterval(() => this.checkAlive(), Math.min(250, this.deadAfterMs / 4));
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.stopPolling();
    this.sock?.destroy();
    this.sock = null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Ao vivo ou sem sinal, pela idade do último relatório (ADR-0007). */
  view(now = this.now()): LinkView {
    return viewLink(this.link, now, this.linkConfig);
  }

  setPollHz(hz: number): void {
    if (hz === this.pollHz) return;
    this.pollHz = hz;
    if (this.connected) this.startPolling();
  }

  get currentPollHz(): number {
    return this.pollHz;
  }

  /**
   * Manda uma linha agora, ou recusa. Nada é guardado para depois: sem
   * conexão, o comando simplesmente não existe (ADR-0007).
   */
  send(line: string): boolean {
    if (!this.connected || !this.sock) return false;
    this.sock.write(`${line}\n`);
    this.linesSent++;
    this.inFlight.push(line);
    return true;
  }

  sendRealtime(byte: number): boolean {
    if (!this.connected || !this.sock) return false;
    this.sock.write(Buffer.from([byte]));
    // O reset descarta tudo o que a placa tinha na fila: nada mais vai responder.
    if (byte === SOFT_RESET) {
      this.linesAcked = this.linesSent;
      this.inFlight = [];
    }
    return true;
  }

  // A placa responde as linhas em ordem, um ok (ou error) por linha. Contar os dois
  // diz se uma linha já terminou: um M3 só responde depois do spin-up (spinup_ms).
  private linesSent = 0;
  private linesAcked = 0;
  /** As linhas ainda sem resposta, na ordem: o próximo ok/error é da primeira. */
  private inFlight: string[] = [];

  /** O número da última linha enviada, para perguntar depois se ela já terminou. */
  get lastLine(): number {
    return this.linesSent;
  }

  /** A linha `n` já recebeu resposta da placa. */
  answered(n: number): boolean {
    return this.linesAcked >= n;
  }

  // ── Conexão e reconexão ────────────────────────────────────────────────────

  private connect(): void {
    if (this.stopped) return;
    const sock = net.connect(this.options.port, this.options.host);
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on('connect', () => {
      if (this.sock !== sock) return;
      this.connected = true;
      this.sessions++;
      this.buf = '';
      this.lastLineAt = this.now();
      this.configLines = [];
      // A configuração vem primeiro: limites e perfil de cada conexão vêm dela
      // (ADR-0008). Depois modo e offsets, como pede o ADR-0007.
      sock.write('$CD\n$I\n$G\n$#\n');
      this.linesSent = 4;
      this.linesAcked = 0;
      this.inFlight = ['$CD', '$I', '$G', '$#'];
      this.startPolling();
      this.emit('connected');
    });
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', () => {});
    sock.on('close', () => {
      if (this.sock !== sock) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.sock = null;
      this.configLines = null;
      this.stopPolling();
      if (wasConnected) this.emit('disconnected');
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const i = Math.min(this.attempt, this.backoffMs.length - 1);
    const delay = this.backoffMs[i] ?? 5_000;
    this.attempt++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private checkAlive(): void {
    if (this.connected && this.sock && this.now() - this.lastLineAt > this.deadAfterMs) {
      // A placa não fala há tempo demais: derruba e começa de novo.
      this.sock.destroy();
    }
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.sock?.write('?'), Math.round(1000 / this.pollHz));
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // ── Leitura ────────────────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    this.buf += chunk.toString('utf8');
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      // Só o fim da linha é aparado: a saída do $CD é YAML, e a indentação é a estrutura.
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      if (line.trim()) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    this.lastLineAt = this.now();
    // Uma linha de verdade: a conexão funciona, o próximo intervalo volta ao menor.
    this.attempt = 0;
    const message = parseLine(line);
    if (message.kind === 'status') {
      this.link = onReport(this.link, this.now(), this.linkConfig);
      this.snapshot = applyReport(this.snapshot, message.report);
      this.emit('status', this.snapshot, message.report);
      return;
    }
    if (message.kind === 'ok' || message.kind === 'error') {
      this.linesAcked = Math.min(this.linesSent, this.linesAcked + 1);
      const line = this.inFlight.shift();
      if (message.kind === 'error' && line !== undefined) this.emit('lineError', { line, code: message.code });
    }
    // Um alarme descarta o que estava na fila da placa, e a linha que o causou
    // (um G38.2 sem toque, por exemplo) não terá ok: a contagem recomeça daqui.
    if (message.kind === 'alarm') {
      this.linesAcked = this.linesSent;
      this.inFlight = [];
    }
    if (this.configLines) {
      if (message.kind === 'ok') {
        const text = this.configLines.join('\n');
        this.configLines = null;
        this.profile = profileFromConfig(text);
        this.emit('profile', this.profile);
        return;
      }
      if (message.kind === 'error') {
        // Placa sem $CD: segue sem perfil, e o movimento fica recusado.
        this.configLines = null;
      } else if (message.kind === 'other' && !line.startsWith('Grbl')) {
        this.configLines.push(line);
        return;
      }
    }
    this.emit('message', message);
  }
}

export interface PollInput {
  viewers: number;
  /** Movimento manual em andamento, ou homing. */
  moving: boolean;
  /** Trabalho rodando ou em pausa. */
  running: boolean;
}

/** A tabela de frequência do ADR-0001: só o necessário. */
export function pollHzFor({ viewers, moving, running }: PollInput): number {
  if (moving) return 10;
  if (viewers > 0 || running) return 4;
  return 1;
}
