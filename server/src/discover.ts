// Achar a placa sozinho quando o roteador muda o IP dela. Na primeira conexão o
// servidor guarda o endereço e o MAC que a própria placa diz no $I; se depois
// ela some por 30 s, ele bate à porta de cada endereço da mesma rede /24 (abre e
// fecha, sem mandar nada: o roteador e os outros aparelhos não veem login
// nenhum), lê na tabela ARP do sistema qual endereço tem aquele MAC, e só a esse
// pergunta $I para confirmar. Nada que mova a máquina.
// A reserva de IP no roteador continua sendo o certo; isto é a rede de segurança.

import net from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Identity {
  mac: string | null;
  /** O `name` da configuração, que o FluidNC diz como "Machine:". */
  name: string | null;
}

/** O MAC como um só jeito de escrever: maiúsculas, separado por dois-pontos. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[-.]/g, ':').toUpperCase();
}

export function identityOf(text: string): Identity {
  const mac = /MAC=([0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})/.exec(text)?.[1];
  const name = /\[MSG:Machine: ([^\]\r\n]+)\]/.exec(text)?.[1]?.trim();
  return { mac: mac ? normalizeMac(mac) : null, name: name ?? null };
}

/** Os 254 endereços da rede /24 de um IPv4; vazio para um nome. */
export function subnetHosts(host: string): string[] {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(host);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
}

/** Abre o telnet, pergunta $I e diz quem respondeu; null se ninguém, ou não é uma placa. */
export function probeHost(host: string, port: number, timeoutMs = 1_500): Promise<Identity | null> {
  return new Promise((resolve) => {
    let text = '';
    let done = false;
    const sock = net.connect(port, host);
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      const id = identityOf(text);
      resolve(id.mac || id.name ? id : null);
    };
    const timer = setTimeout(finish, timeoutMs);
    sock.on('connect', () => sock.write('$I\n'));
    sock.on('data', (chunk) => {
      text += chunk.toString('latin1');
      if (text.length > 4_096 || (identityOf(text).mac && /\nok\r?\n/.test(text))) finish();
    });
    sock.on('error', finish);
    sock.on('close', finish);
  });
}

/** A tabela ARP do Linux (/proc/net/arp): MAC → IP, só as entradas completas. */
export function parseArp(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n').slice(1)) {
    const [ip, , flags, mac] = line.trim().split(/\s+/);
    if (!ip || !mac || flags === '0x0' || mac === '00:00:00:00:00:00') continue;
    out.set(normalizeMac(mac), ip);
  }
  return out;
}

/** Abre e fecha uma conexão em cada endereço, sem mandar nada: o bastante para o sistema aprender os MACs. */
export async function touchHosts(hosts: readonly string[], port: number, timeoutMs = 800, concurrency = 64): Promise<void> {
  let next = 0;
  const knock = (host: string) =>
    new Promise<void>((resolve) => {
      const sock = net.connect(port, host);
      const done = () => {
        clearTimeout(timer);
        sock.destroy();
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      sock.on('connect', done);
      sock.on('error', done);
    });
  const worker = async () => {
    while (next < hosts.length) await knock(hosts[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
}

/**
 * A procura de verdade, no servidor (Linux): bate em todos, acha o MAC na tabela
 * ARP e confirma com $I só naquele endereço. Sem /proc/net/arp (um Mac, em
 * desenvolvimento), pergunta $I a quem tem a porta aberta.
 */
export async function scanForBoard(hosts: readonly string[], mac: string, port: number, readArp: () => string | null = readProcArp): Promise<string | null> {
  const target = normalizeMac(mac);
  await touchHosts(hosts, port);
  const arp = readArp();
  if (arp === null) return findBoard(hosts, { mac: target }, { probe: (h) => probeHost(h, port) });
  const ip = parseArp(arp).get(target);
  if (!ip) return null;
  return (await probeHost(ip, port))?.mac === target ? ip : null;
}

function readProcArp(): string | null {
  try {
    return readFileSync('/proc/net/arp', 'utf8');
  } catch {
    return null;
  }
}

/** Procura, em paralelo, o endereço cujo $I tem o MAC procurado. */
export async function findBoard(
  hosts: readonly string[],
  want: { mac: string },
  opts: { probe?: (host: string) => Promise<Identity | null>; concurrency?: number } = {},
): Promise<string | null> {
  const probe = opts.probe ?? ((h: string) => probeHost(h, 23));
  const target = normalizeMac(want.mac);
  let found: string | null = null;
  let next = 0;
  const worker = async () => {
    while (!found && next < hosts.length) {
      const host = hosts[next++]!;
      const id = await probe(host);
      if (id?.mac === target) found = host;
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 48, hosts.length) }, worker));
  return found;
}

/** O endereço e o MAC da placa, como vistos na última conexão boa. */
export interface KnownBoard {
  host: string;
  mac: string | null;
  /** O RLIGHT_BOARD_HOST de quando foi gravado: se alguém mudar à mão, vale o novo. */
  configured?: string;
}

export interface KnownBoardMemory {
  read(): KnownBoard | null;
  write(k: KnownBoard): void;
}

export const noKnownBoardMemory: KnownBoardMemory = { read: () => null, write: () => {} };

export function fileKnownBoardMemory(path: string): KnownBoardMemory {
  return {
    read() {
      try {
        const k = JSON.parse(readFileSync(path, 'utf8')) as KnownBoard;
        if (typeof k?.host !== 'string' || !k.host) return null;
        return { host: k.host, mac: typeof k.mac === 'string' ? k.mac : null, ...(typeof k.configured === 'string' ? { configured: k.configured } : {}) };
      } catch {
        return null;
      }
    },
    write(k) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(k) + '\n');
      } catch {
        /* sem onde gravar: vale até o próximo reinício */
      }
    },
  };
}

/** O que o BoardFinder precisa da conexão com a placa. */
export interface FinderBoard {
  readonly host: string;
  readonly isConnected: boolean;
  readonly mac: string | null;
  setHost(host: string): void;
}

/** Sem a placa por isto, procura na rede. */
export const LOST_BEFORE_SCAN_MS = 30_000;
/** Entre uma procura que não achou e a próxima: dobra até o teto (a máquina pode estar desligada a noite toda). */
export const SCAN_EVERY_MS = 120_000;
export const SCAN_EVERY_MAX_MS = 15 * 60_000;

export class BoardFinder {
  #lostSince: number | null = null;
  #lastScan = -Infinity;
  #scanning = false;
  #every = SCAN_EVERY_MS;

  constructor(
    private readonly o: {
      board: FinderBoard;
      memory: KnownBoardMemory;
      scan: (hosts: string[], mac: string) => Promise<string | null>;
      now?: () => number;
      log?: (msg: string) => void;
    },
  ) {}

  /** Uma olhada: a cada poucos segundos. */
  async tick(): Promise<void> {
    const { board, memory } = this.o;
    const now = (this.o.now ?? Date.now)();
    if (board.isConnected) {
      this.#lostSince = null;
      this.#every = SCAN_EVERY_MS;
      const known = memory.read();
      if (board.mac && (known?.host !== board.host || known?.mac !== board.mac)) memory.write({ host: board.host, mac: board.mac });
      return;
    }
    this.#lostSince ??= now;
    const mac = memory.read()?.mac;
    if (!mac || this.#scanning) return;
    if (now - this.#lostSince < LOST_BEFORE_SCAN_MS || now - this.#lastScan < this.#every) return;
    if (this.#lastScan > -Infinity) this.#every = Math.min(this.#every * 2, SCAN_EVERY_MAX_MS);
    this.#scanning = true;
    this.#lastScan = now;
    try {
      const found = await this.o.scan(subnetHosts(board.host), mac);
      if (found && found !== board.host) {
        (this.o.log ?? console.log)(`placa: achada em ${found} (antes em ${board.host})`);
        board.setHost(found);
        memory.write({ host: found, mac });
      }
    } finally {
      this.#scanning = false;
    }
  }
}
