import { afterEach, describe, expect, it, vi } from 'vitest';
import * as memNet from '../demo/net';
import * as memWs from '../demo/ws';
import type { ServerMessage } from '../src/messages';
import { until } from './helpers';

// A demonstração pública (GitHub Pages): o FluidNC falso, a placa e o portão de
// verdade rodando dentro da página. Só o transporte muda: `node:net` e `ws` viram
// canos em memória, e o resto do servidor não sabe a diferença.
vi.mock('node:net', () => import('../demo/net'));
vi.mock('ws', () => import('../demo/ws'));
vi.mock('node:fs', () => import('../demo/fs'));
vi.mock('node:path', () => import('../demo/path'));

describe('node:net em memória', () => {
  it('liga cliente e servidor e leva bytes nos dois sentidos', async () => {
    const got: string[] = [];
    const server = memNet.createServer((sock) => {
      sock.on('data', (chunk) => {
        got.push(chunk.toString());
        sock.write('ok\r\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const client = memNet.connect(port, '127.0.0.1');
    const replies: string[] = [];
    client.on('data', (chunk) => replies.push(chunk.toString('utf8')));
    await new Promise((r) => client.on('connect', r));
    client.write('$I\n');
    await until(() => replies.length >= 1, { what: 'resposta' });
    expect(got).toEqual(['$I\n']);
    expect(replies).toEqual(['ok\r\n']);
    server.close();
  });

  it('entrega os bytes crus, percorríveis como num Buffer', async () => {
    const bytes: number[] = [];
    const server = memNet.createServer((sock) => sock.on('data', (chunk) => bytes.push(...chunk)));
    server.listen(23, 'demo');
    const client = memNet.connect(23, 'demo');
    await new Promise((r) => client.on('connect', r));
    client.write(Uint8Array.from([0x18, 0x3f]));
    await until(() => bytes.length === 2, { what: 'bytes' });
    expect(bytes).toEqual([0x18, 0x3f]);
    server.close();
  });

  it('sem servidor na porta, a conexão falha e fecha, como uma recusada', async () => {
    const client = memNet.connect(9, 'demo');
    const events: string[] = [];
    client.on('error', () => events.push('error'));
    client.on('close', () => events.push('close'));
    await until(() => events.includes('close'), { what: 'close' });
    expect(events).toEqual(['error', 'close']);
  });

  it('destroy fecha os dois lados', async () => {
    let serverSide: memNet.Socket | null = null;
    const server = memNet.createServer((sock) => (serverSide = sock));
    server.listen(24, 'demo');
    const client = memNet.connect(24, 'demo');
    await new Promise((r) => client.on('connect', r));
    const closed: string[] = [];
    client.on('close', () => closed.push('client'));
    serverSide!.on('close', () => closed.push('server'));
    serverSide!.destroy();
    await until(() => closed.length === 2, { what: 'os dois fecharem' });
    expect(client.destroyed).toBe(true);
    expect(serverSide!.destroyed).toBe(true);
    server.close();
  });
});

describe('ws em memória', () => {
  it('a tela abre, troca mensagens e é avisada quando o servidor termina a conexão', async () => {
    const wss = new memWs.WebSocketServer({ port: 4001, host: 'demo' });
    const fromClient: string[] = [];
    wss.on('connection', (ws: memWs.WebSocket) => {
      ws.on('message', (data) => {
        fromClient.push(data.toString());
        ws.send('pong');
      });
    });
    await new Promise((r) => wss.once('listening', r));
    expect(wss.address().port).toBe(4001);

    const sock = memWs.connectClient(4001);
    const got: string[] = [];
    let closed = false;
    sock.onmessage = (e) => got.push(String(e.data));
    sock.onclose = () => (closed = true);
    await new Promise<void>((r) => (sock.onopen = () => r()));
    expect(sock.readyState).toBe(memWs.WebSocket.OPEN);
    sock.send('ping');
    await until(() => got.length === 1, { what: 'pong' });
    expect(fromClient).toEqual(['ping']);

    for (const c of wss.clients) c.terminate();
    await until(() => closed, { what: 'close' });
    expect(sock.readyState).toBe(memWs.WebSocket.CLOSED);
    await new Promise<void>((r) => wss.close(() => r()));
  });

  it('uma tela que fecha avisa o servidor', async () => {
    const wss = new memWs.WebSocketServer({ port: 4002 });
    let gone = false;
    wss.on('connection', (ws: memWs.WebSocket) => ws.on('close', () => (gone = true)));
    const sock = memWs.connectClient(4002);
    await new Promise<void>((r) => (sock.onopen = () => r()));
    sock.close();
    await until(() => gone, { what: 'close no servidor' });
    await new Promise<void>((r) => wss.close(() => r()));
  });
});

describe('a demonstração na página', () => {
  let stop: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  it('o portão de verdade atende a tela: perfil, controle, Ir e spindle com spin-up', async () => {
    const { startDemo } = await import('../demo/in-page');
    const demo = startDemo({ spinupMs: 300, homingMs: 50 });
    stop = demo.stop;
    const sock = demo.open();
    const inbox: ServerMessage[] = [];
    sock.onmessage = (e) => inbox.push(JSON.parse(String(e.data)) as ServerMessage);
    await new Promise<void>((r) => (sock.onopen = () => r()));
    const of = <T extends ServerMessage['type']>(type: T) =>
      inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);

    // O perfil vem do config-dump.yaml gravado da máquina de referência.
    const profile = await until(() => of('profile')[0], { what: 'perfil' });
    expect(profile.limits.x).toBeDefined();
    await until(() => of('state').some((s) => s.machine?.state === 'Idle'), { what: 'estado' });

    sock.send(JSON.stringify({ type: 'takeControl', token: 'demo-token-0123456789' }));
    await until(() => of('control').some((c) => c.inControl), { what: 'controle' });

    // A demonstração já começa referenciada: o Ir anda sem pedir homing.
    sock.send(JSON.stringify({ type: 'command', id: 'r1', command: 'jogTo', x: 420, y: 130 }));
    const r1 = await until(() => of('result').find((r) => r.id === 'r1'), { what: 'resultado do Ir' });
    expect(r1.ok).toBe(true);
    await until(() => of('state').some((s) => s.machine?.state === 'Jog'), { what: 'andando' });
    await until(
      () => {
        const last = of('state').at(-1)?.machine;
        return last?.state === 'Idle' && Math.abs((last.mpos?.x ?? 0) - 420) < 0.01;
      },
      { what: 'chegar', timeoutMs: 5_000 },
    );

    sock.send(JSON.stringify({ type: 'command', id: 'r2', command: 'spindleOn', rpm: 12000 }));
    const r2 = await until(() => of('result').find((r) => r.id === 'r2'), { what: 'resultado do spindle' });
    expect(r2.ok).toBe(true);
    await until(() => of('state').some((s) => s.machine?.spindleOn === true), { what: 'spindle ligado', timeoutMs: 3_000 });
  });
});
