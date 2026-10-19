import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { Alert } from '../src/alerts';
import { Board } from '../src/board';
import { Gateway } from '../src/gateway';
import type { ServerMessage } from '../src/messages';
import type { PushSubscriptionJSON } from '../src/push';
import { FakeFluidNC } from './fake-fluidnc';
import { sleep, until } from './helpers';

// Os avisos no celular, de ponta a ponta: o aparelho se inscreve pela tela, a
// placa entra em alarme, o servidor manda o aviso. O envio à Apple é falso.

let fake: FakeFluidNC;
let board: Board;
let gateway: Gateway;
let wsPort: number;
const opened: WebSocket[] = [];
const sent: { to: string; alert: Alert }[] = [];
let saved: PushSubscriptionJSON[] = [];
let gone = new Set<string>();

const sub = (n: number): PushSubscriptionJSON => ({ endpoint: `https://web.push.apple.com/QG${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

async function setup() {
  sent.length = 0;
  saved = [];
  gone = new Set();
  fake = new FakeFluidNC({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 } });
  const port = await fake.listen();
  board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
  board.start();
  gateway = new Gateway({
    board,
    push: {
      publicKey: 'BPUBLICA',
      send: async (to, alert) => {
        sent.push({ to: to.endpoint, alert });
        return { gone: gone.has(to.endpoint) };
      },
    },
    pushDevices: { read: () => saved, write: (d) => (saved = d) },
  });
  wsPort = await gateway.start();
}

afterEach(async () => {
  for (const ws of opened.splice(0)) ws.terminate();
  await gateway?.close();
  board?.stop();
  await fake?.close();
});

async function browser() {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  opened.push(ws);
  const inbox: ServerMessage[] = [];
  ws.on('message', (data) => inbox.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  return { inbox, send: (msg: object) => ws.send(JSON.stringify(msg)) };
}

describe('gateway: avisos no celular', () => {
  it('a tela recebe a chave pública; inscrever guarda o aparelho e manda um aviso de prova', async () => {
    await setup();
    const b = await browser();
    await until(() => b.inbox.find((m) => m.type === 'pushKey'), { what: 'pushKey' });
    expect(b.inbox.find((m) => m.type === 'pushKey')).toEqual({ type: 'pushKey', publicKey: 'BPUBLICA' });
    b.send({ type: 'pushSubscribe', subscription: sub(1) });
    await until(() => b.inbox.find((m) => m.type === 'push'), { what: 'push' });
    expect(b.inbox.find((m) => m.type === 'push')).toEqual({ type: 'push', subscribed: true });
    expect(saved.map((d) => d.endpoint)).toEqual([sub(1).endpoint]);
    await until(() => sent.length === 1, { what: 'aviso de prova' });
    expect(sent[0]).toMatchObject({ to: sub(1).endpoint, alert: { kind: 'test' } });
    // A mesma inscrição de novo (a tela reconectou): sem outro aviso de prova.
    b.send({ type: 'pushSubscribe', subscription: sub(1) });
    await sleep(50);
    expect(sent).toHaveLength(1);
  });

  it('um alarme avisa os aparelhos, menos o que está com o app à vista', async () => {
    await setup();
    const phone = await browser();
    const other = await browser();
    phone.send({ type: 'pushSubscribe', subscription: sub(1) });
    other.send({ type: 'pushSubscribe', subscription: sub(2) });
    await until(() => sent.length === 2, { what: 'avisos de prova' });
    phone.send({ type: 'watching', endpoint: sub(1).endpoint });
    await until(() => gateway.viewers === 2 && board.snapshot, { what: 'placa' });
    await sleep(50);
    fake.alarm(1);
    await until(() => sent.some((s) => s.alert.kind === 'alarm'), { what: 'aviso de alarme' });
    const alarms = sent.filter((s) => s.alert.kind === 'alarm');
    expect(alarms.map((s) => s.to)).toEqual([sub(2).endpoint]);
    expect(alarms[0]?.alert.body).toBe('Um fim de curso foi acionado.');
  });

  it('o aparelho que desistiu dos avisos é esquecido; desinscrever também tira', async () => {
    await setup();
    const b = await browser();
    gone.add(sub(1).endpoint);
    b.send({ type: 'pushSubscribe', subscription: sub(1) });
    b.send({ type: 'pushSubscribe', subscription: sub(2) });
    await until(() => saved.length === 1, { what: 'esquecer o aparelho' });
    expect(saved.map((d) => d.endpoint)).toEqual([sub(2).endpoint]);
    b.send({ type: 'pushUnsubscribe', endpoint: sub(2).endpoint });
    await until(() => saved.length === 0, { what: 'desinscrever' });
  });

  it('endereço que não é de push é recusado', async () => {
    await setup();
    const b = await browser();
    b.send({ type: 'pushSubscribe', subscription: { endpoint: 'https://192.168.1.10/x', keys: { p256dh: 'p', auth: 'a' } } });
    await until(() => b.inbox.find((m) => m.type === 'push'), { what: 'push' });
    expect(b.inbox.find((m) => m.type === 'push')).toEqual({ type: 'push', subscribed: false });
    expect(sent).toEqual([]);
  });
});
