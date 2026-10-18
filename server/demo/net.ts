// `node:net` em memória, para a demonstração rodar na página: o FluidNC falso
// ouve numa "porta" e a placa (server/src/board.ts) se conecta a ela por um cano.
// Só o que o servidor e o falso usam: createServer, connect, write, destroy.

import { Emitter, later } from './emitter';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Um pedaço de bytes que, como o Buffer, sabe virar texto. */
export class Chunk extends Uint8Array {
  override toString(_encoding?: string): string {
    return decoder.decode(this);
  }
}

export const bytes = (data: string | ArrayLike<number>): Chunk =>
  typeof data === 'string' ? new Chunk(encoder.encode(data)) : Chunk.from(data);

const servers = new Map<number, Server>();
let nextPort = 40_000;

export class Socket extends Emitter {
  destroyed = false;
  peer: Socket | null = null;

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  write(data: string | Uint8Array): boolean {
    const peer = this.peer;
    if (this.destroyed || !peer) return false;
    const chunk = bytes(data);
    later(() => {
      if (!peer.destroyed) peer.emit('data', chunk);
    });
    return true;
  }

  destroy(): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    const peer = this.peer;
    later(() => this.emit('close', false));
    peer?.destroy();
    return this;
  }

  end(): this {
    return this.destroy();
  }

  /** Para o servidor em memória: entrega o lado de lá. */
  _connected(): void {
    this.emit('connect');
  }

  /** Ninguém ouvindo: como uma conexão recusada. */
  _refused(): void {
    this.destroyed = true;
    this.emit('error', new Error('ECONNREFUSED'));
    this.emit('close', true);
  }
}

export class Server extends Emitter {
  #port: number | null = null;

  constructor(private readonly onConnection: (sock: Socket) => void) {
    super();
  }

  listen(port = 0, _host?: string, cb?: () => void): this {
    const p = port || nextPort++;
    this.#port = p;
    servers.set(p, this);
    later(() => {
      this.emit('listening');
      cb?.();
    });
    return this;
  }

  address(): { port: number; address: string; family: string } {
    return { port: this.#port ?? 0, address: 'memory', family: 'memory' };
  }

  close(cb?: () => void): this {
    if (this.#port !== null && servers.get(this.#port) === this) servers.delete(this.#port);
    later(() => cb?.());
    return this;
  }

  _accept(client: Socket): void {
    const side = new Socket();
    side.peer = client;
    client.peer = side;
    this.onConnection(side);
    client._connected();
  }
}

export function createServer(onConnection: (sock: Socket) => void): Server {
  return new Server(onConnection);
}

export function connect(port: number | { port: number; host?: string }, _host?: string): Socket {
  const p = typeof port === 'number' ? port : port.port;
  const sock = new Socket();
  later(() => {
    const server = servers.get(p);
    if (server) server._accept(sock);
    else sock._refused();
  });
  return sock;
}

export const createConnection = connect;

export default { createServer, connect, createConnection, Socket, Server };
