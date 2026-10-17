// Um FluidNC falso para os testes do servidor: um servidor TCP que fala como a
// placa de referência (FluidNC v3.9.9 no telnet), com as respostas gravadas no
// spike S1 e com as falhas que a bancada mostrou: quedas, pausas de ~1,3 s sem
// resposta e alarmes (ADR-0007).

import fs from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { MachineState } from '@rlight/core';

const FIXTURES = new URL('../../core/test/fixtures/fluidnc-3.9.9/', import.meta.url);
const fixture = (name: string) => fs.readFileSync(new URL(name, FIXTURES), 'utf8');

/** A saída do preâmbulo gravado, separada por comando: $I, $G e $#, nessa ordem. */
function preambleBlocks(): { info: string[]; gcode: string[]; offsets: string[] } {
  const blocks: string[][] = [[]];
  for (const line of fixture('preamble.txt').split(/\r?\n/)) {
    if (!line) continue;
    blocks[blocks.length - 1]!.push(line);
    if (line === 'ok') blocks.push([]);
  }
  return { info: blocks[0] ?? [], gcode: blocks[1] ?? [], offsets: blocks[2] ?? [] };
}

export interface Vec {
  x: number;
  y: number;
  z: number;
}

interface Segment {
  target: Vec;
  feedMmPerMin: number;
}

export interface FakeOptions {
  /** Estado ao ligar. A placa de referência liga em alarme (`must_home`). */
  state?: MachineState;
  mpos?: Vec;
  /** Posição de máquina ao fim do homing. */
  homePos?: Vec;
  homingMs?: number;
  /** Passo da simulação de movimento. */
  tickMs?: number;
}

const fmt = (v: number) => (Object.is(v, -0) ? 0 : v).toFixed(3);
const vec = (v: Vec) => `${fmt(v.x)},${fmt(v.y)},${fmt(v.z)}`;

export class FakeFluidNC {
  state: MachineState;
  mpos: Vec;
  wco: Vec = { x: 0, y: 0, z: 0 };
  /** Tudo o que chegou da conexão, na ordem: linhas e caracteres de tempo real. */
  readonly received: string[] = [];
  /** Quantas conexões a placa aceitou desde que ligou. */
  connections = 0;
  /** Tentativas de conexão, inclusive as recusadas. */
  attempts = 0;

  private readonly server = net.createServer((sock) => this.accept(sock));
  private readonly sockets = new Set<net.Socket>();
  private readonly homePos: Vec;
  private readonly homingMs: number;
  private readonly tickMs: number;
  private queue: Segment[] = [];
  private reports = 0;
  private frozenUntil = 0;
  private refusing = false;
  private homingTimer: NodeJS.Timeout | null = null;
  private readonly ticker: NodeJS.Timeout;
  private readonly blocks = preambleBlocks();
  private readonly configDump = fixture('config-dump.yaml');

  constructor(options: FakeOptions = {}) {
    this.state = options.state ?? 'Alarm';
    this.mpos = { ...(options.mpos ?? { x: 0, y: 0, z: 0 }) };
    this.homePos = options.homePos ?? { x: 0, y: 0, z: 0 };
    this.homingMs = options.homingMs ?? 50;
    this.tickMs = options.tickMs ?? 10;
    this.ticker = setInterval(() => this.step(this.tickMs), this.tickMs);
  }

  async listen(port = 0): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    return (this.server.address() as AddressInfo).port;
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    clearInterval(this.ticker);
    if (this.homingTimer) clearTimeout(this.homingTimer);
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // ── Falhas injetáveis ──────────────────────────────────────────────────────

  /** Derruba as conexões abertas, como o Wi-Fi do painel. */
  dropConnections(): void {
    for (const s of this.sockets) s.destroy();
  }

  /** Recusa (derruba na hora) novas conexões até `acceptConnections()`. */
  refuseConnections(): void {
    this.refusing = true;
    this.dropConnections();
  }

  acceptConnections(): void {
    this.refusing = false;
  }

  /**
   * A placa para de responder por `ms`, sem derrubar nada, como nas pausas que
   * a WebUI causou no S1. O que chega nesse meio-tempo é atendido depois.
   */
  freeze(ms: number): void {
    this.frozenUntil = Date.now() + ms;
  }

  get frozen(): boolean {
    return Date.now() < this.frozenUntil;
  }

  alarm(code = 1): void {
    this.queue = [];
    this.state = 'Alarm';
    this.broadcast(`ALARM:${code}`);
  }

  /** Só os jogs que chegaram à placa. */
  get jogs(): string[] {
    return this.received.filter((l) => l.startsWith('$J='));
  }

  // ── A conexão ──────────────────────────────────────────────────────────────

  private accept(sock: net.Socket): void {
    this.attempts++;
    if (this.refusing) {
      sock.destroy();
      return;
    }
    this.connections++;
    this.sockets.add(sock);
    sock.setNoDelay(true);
    sock.on('close', () => this.sockets.delete(sock));
    sock.on('error', () => {});
    let line = '';
    let pending: Buffer[] = [];
    let flushTimer: NodeJS.Timeout | null = null;

    const handle = (chunk: Buffer) => {
      for (const byte of chunk) {
        const c = String.fromCharCode(byte);
        // Caracteres de tempo real valem em qualquer ponto do fluxo, como na placa.
        if (c === '?' || c === '!' || c === '~' || byte === 0x85 || byte === 0x18) {
          this.realtime(sock, byte);
        } else if (c === '\n' || c === '\r') {
          const cmd = line.trim();
          line = '';
          if (cmd) this.command(sock, cmd);
        } else {
          line += c;
        }
      }
    };
    const flush = () => {
      flushTimer = null;
      if (this.frozen) {
        flushTimer = setTimeout(flush, this.frozenUntil - Date.now());
        return;
      }
      const chunks = pending;
      pending = [];
      if (!sock.destroyed) for (const c of chunks) handle(c);
    };
    sock.on('data', (chunk: Buffer) => {
      if (this.frozen || pending.length) {
        pending.push(chunk);
        if (!flushTimer) flushTimer = setTimeout(flush, Math.max(0, this.frozenUntil - Date.now()));
        return;
      }
      handle(chunk);
    });
    sock.on('close', () => flushTimer && clearTimeout(flushTimer));
  }

  private write(sock: net.Socket, ...lines: string[]): void {
    if (!sock.destroyed) sock.write(lines.map((l) => `${l}\r\n`).join(''));
  }

  private broadcast(line: string): void {
    for (const s of this.sockets) this.write(s, line);
  }

  private realtime(sock: net.Socket, byte: number): void {
    const c = String.fromCharCode(byte);
    this.received.push(byte === 0x85 ? '0x85' : byte === 0x18 ? '0x18' : c);
    if (c === '?') this.write(sock, this.report());
    else if (byte === 0x85) {
      // Cancelamento de jog: para onde estiver e volta ao repouso.
      if (this.state === 'Jog') {
        this.queue = [];
        this.state = 'Idle';
      }
    } else if (byte === 0x18) {
      this.queue = [];
      this.state = 'Alarm';
      this.write(sock, 'Grbl 3.9 [FluidNC v3.9.9 (fake) \'$\' for help]');
    } else if (c === '!' && (this.state === 'Jog' || this.state === 'Run')) this.state = 'Hold';
    else if (c === '~' && this.state === 'Hold') this.state = this.queue.length ? 'Jog' : 'Idle';
  }

  /** Um relatório como os gravados: WCO a cada 10, Ov logo depois, Pn durante o homing. */
  report(): string {
    const n = this.reports++;
    const parts = [this.state, `MPos:${vec(this.mpos)}`, `FS:${this.queue[0]?.feedMmPerMin ?? 0},0`];
    if (this.state === 'Home') parts.push('Pn:X');
    if (n % 10 === 4) parts.push(`WCO:${vec(this.wco)}`);
    if (n % 10 === 5) parts.push('Ov:100,100,100');
    return `<${parts.join('|')}>`;
  }

  private command(sock: net.Socket, cmd: string): void {
    this.received.push(cmd);
    if (cmd === '$CD') {
      const lines = this.configDump.split(/\r?\n/).filter((l) => l.trim());
      this.write(sock, ...lines, 'ok');
    } else if (cmd === '$I') this.write(sock, ...this.blocks.info);
    else if (cmd === '$G') this.write(sock, ...this.blocks.gcode);
    else if (cmd === '$#') this.write(sock, ...this.blocks.offsets);
    else if (cmd === '$X') {
      if (this.state === 'Alarm') this.state = 'Idle';
      this.write(sock, '[MSG:Caution: Unlocked]', 'ok');
    } else if (cmd === '$H') this.home(sock);
    else if (cmd.startsWith('$J=')) this.jog(sock, cmd);
    else this.write(sock, 'error:20');
  }

  private home(sock: net.Socket): void {
    if (this.state !== 'Alarm' && this.state !== 'Idle') {
      this.write(sock, 'error:9');
      return;
    }
    this.queue = [];
    this.state = 'Home';
    this.homingTimer = setTimeout(() => {
      this.homingTimer = null;
      this.mpos = { ...this.homePos };
      this.state = 'Idle';
      this.write(sock, 'ok');
    }, this.homingMs);
  }

  /** Só jogs absolutos em coordenadas de máquina, como o servidor manda (ADR-0002). */
  private jog(sock: net.Socket, cmd: string): void {
    const m = /^\$J=G53 G90((?: [XYZ]-?\d+(?:\.\d+)?)+) F(\d+(?:\.\d+)?)$/.exec(cmd);
    if (!m) {
      this.write(sock, 'error:2');
      return;
    }
    if (this.state !== 'Idle' && this.state !== 'Jog') {
      this.write(sock, 'error:9');
      return;
    }
    const last = this.queue[this.queue.length - 1]?.target ?? this.mpos;
    const target = { ...last };
    for (const word of m[1]!.trim().split(' ')) {
      const axis = word[0]!.toLowerCase() as keyof Vec;
      target[axis] = Number(word.slice(1));
    }
    this.queue.push({ target, feedMmPerMin: Number(m[2]) });
    this.state = 'Jog';
    this.write(sock, 'ok');
  }

  /** Anda em linha reta até o próximo destino da fila, no avanço pedido. */
  private step(dtMs: number): void {
    if (this.state !== 'Jog') return;
    let budget = (dtMs / 60_000) * (this.queue[0]?.feedMmPerMin ?? 0);
    while (this.queue.length && budget > 0) {
      const seg = this.queue[0]!;
      const d = { x: seg.target.x - this.mpos.x, y: seg.target.y - this.mpos.y, z: seg.target.z - this.mpos.z };
      const dist = Math.hypot(d.x, d.y, d.z);
      if (dist <= budget) {
        this.mpos = { ...seg.target };
        budget -= dist;
        this.queue.shift();
      } else {
        const k = budget / dist;
        this.mpos = { x: this.mpos.x + d.x * k, y: this.mpos.y + d.y * k, z: this.mpos.z + d.z * k };
        budget = 0;
      }
    }
    if (!this.queue.length) this.state = 'Idle';
  }
}
