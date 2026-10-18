// O pacote `ws` em memória, para a demonstração: o portão (server/src/gateway.ts)
// abre o seu WebSocketServer de sempre, e a tela se conecta por connectClient,
// que devolve algo com a cara do WebSocket do navegador.

import { Emitter, later } from './emitter';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

const servers = new Map<number, WebSocketServer>();

/** O lado do servidor de uma conexão, como o WebSocket do `ws`. */
export class WebSocket extends Emitter {
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSED = CLOSED;
  readyState = OPEN;

  constructor(private readonly client: ClientSocket) {
    super();
  }

  send(data: string): void {
    if (this.readyState !== OPEN) return;
    later(() => this.client._message(data));
  }

  terminate(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    later(() => {
      this.emit('close');
      this.client._closed();
    });
  }

  close(): void {
    this.terminate();
  }

  /** Para a tela em memória. */
  _message(data: string): void {
    if (this.readyState === OPEN) this.emit('message', data);
  }
}

/** O lado da tela: a forma do WebSocket do navegador (onopen, onmessage...). */
export class ClientSocket {
  readyState = CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #server: WebSocket | null = null;

  send(data: string): void {
    const s = this.#server;
    if (this.readyState !== OPEN || !s) return;
    later(() => s._message(data));
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    if (this.#server) this.#server.terminate();
    else this._closed();
  }

  _open(server: WebSocket): void {
    this.#server = server;
    this.readyState = OPEN;
    this.onopen?.();
  }

  _message(data: string): void {
    if (this.readyState === OPEN) this.onmessage?.({ data });
  }

  _closed(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onclose?.();
  }
}

export class WebSocketServer extends Emitter {
  readonly clients = new Set<WebSocket>();
  readonly #port: number;

  constructor(options: { port?: number; host?: string }) {
    super();
    this.#port = options.port || 8787;
    servers.set(this.#port, this);
    later(() => this.emit('listening'));
  }

  address(): { port: number; address: string; family: string } {
    return { port: this.#port, address: 'memory', family: 'memory' };
  }

  close(cb?: () => void): void {
    if (servers.get(this.#port) === this) servers.delete(this.#port);
    for (const c of this.clients) c.terminate();
    later(() => cb?.());
  }

  _accept(client: ClientSocket): void {
    const ws = new WebSocket(client);
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.emit('connection', ws);
    client._open(ws);
  }
}

/** Uma tela que se conecta ao portão na `port`. Sem portão, fecha, como um servidor fora do ar. */
export function connectClient(port: number): ClientSocket {
  const client = new ClientSocket();
  later(() => {
    const server = servers.get(port);
    if (server) server._accept(client);
    else {
      client.onerror?.();
      client._closed();
    }
  });
  return client;
}

export default { WebSocket, WebSocketServer, connectClient };
