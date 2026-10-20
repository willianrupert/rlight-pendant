import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Board } from '../src/board';
import { Gateway } from '../src/gateway';
import type { ServerMessage } from '../src/messages';
import { FakeFluidNC } from './fake-fluidnc';
import { until } from './helpers';

// Os trabalhos (v2), de ponta a ponta com a placa falsa: guardar o arquivo pela
// tela, abrir conferido contra o zero da peça, contornar no ar, apagar.

let fake: FakeFluidNC;
let board: Board;
let gateway: Gateway;
let wsPort: number;
const opened: WebSocket[] = [];

const job = `G21 G90
G0 Z5
G0 X0 Y0
G1 Z-3 F300
G1 X40 F1200
G1 Y20
G1 X0
G1 Y0
G0 Z5
M30`;

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
  let seq = 0;
  const of = <T extends ServerMessage['type']>(type: T) => inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return {
    of,
    state: () => of('state').at(-1),
    send: (msg: object) => ws.send(JSON.stringify(msg)),
    async command(cmd: object) {
      const id = `r${++seq}`;
      ws.send(JSON.stringify({ type: 'command', id, ...cmd }));
      return until(() => of('result').find((r) => r.id === id), { what: `resposta de ${id}` });
    },
  };
}

describe('gateway: os trabalhos', () => {
  it('guarda, abre conferido contra o zero, contorna no ar e apaga', async () => {
    fake = new FakeFluidNC({ state: 'Alarm', homePos: { x: 0, y: 0, z: 0 }, homingMs: 300 });
    const port = await fake.listen();
    board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board });
    wsPort = await gateway.start();

    const b = await browser();
    await until(() => b.state()?.link.mode === 'live' && b.of('profile')[0], { what: 'placa' });
    expect(b.of('jobs')[0]).toEqual({ type: 'jobs', jobs: [] });

    // O arquivo chega pela tela; todas as telas recebem a biblioteca nova.
    b.send({ type: 'jobUpload', name: 'tampa.nc', text: job });
    const added = await until(() => b.of('jobAdded')[0], { what: 'jobAdded' });
    if (!added.ok) throw new Error(added.reason);
    await until(() => b.of('jobs').at(-1)?.jobs.length === 1, { what: 'biblioteca' });

    // Sem homing: abre, mas não põe na mesa; contornar é recusado pela policy.
    b.send({ type: 'jobOpen', jobId: added.jobId });
    const first = await until(() => b.of('job')[0], { what: 'job' });
    expect('job' in first && first.job.bounds.machine).toBeNull();

    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    expect(await b.command({ command: 'frameJob', jobId: added.jobId })).toMatchObject({ ok: false });
    await b.command({ command: 'home' });
    await until(() => b.state()?.homed && b.state()?.machine?.state === 'Idle', { what: 'homing' });

    // O zero da peça em X 100, Y 100, Z −50.
    await b.command({ command: 'jogTo', x: 100, y: 100 });
    await until(() => b.state()?.machine?.mpos?.x === 100 && b.state()?.machine?.state === 'Idle', { what: 'em X 100', timeoutMs: 10_000 });
    await b.command({ command: 'jogAxisTo', axis: 'z', value: -50 });
    await until(() => b.state()?.machine?.mpos?.z === -50 && b.state()?.machine?.state === 'Idle', { what: 'em Z −50', timeoutMs: 10_000 });
    expect(await b.command({ command: 'zero', axis: 'all' })).toMatchObject({ ok: true });
    await until(() => b.state()?.machine?.wco?.x === 100, { what: 'zero da peça' });

    b.send({ type: 'jobOpen', jobId: added.jobId });
    const open = await until(() => b.of('job').find((m) => 'job' in m && m.job.bounds.machine), { what: 'job conferido' });
    if (!('job' in open)) throw new Error('sem trabalho');
    expect(open.job.bounds.machine).toEqual({ min: { x: 100, y: 100, z: -53 }, max: { x: 140, y: 120, z: -45 } });
    expect(open.job.problems).toEqual([]);
    expect(open.job.preview.cuts[0]).toEqual([0, 0, 40, 0, 40, 20, 0, 20, 0, 0]);

    // Contornar no ar: sobe 10 mm acima da peça e percorre o retângulo, voltando ao primeiro canto.
    const before = fake.received.length;
    expect(await b.command({ command: 'frameJob', jobId: added.jobId })).toMatchObject({ ok: true });
    const jogs = () => fake.received.slice(before).filter((l) => l.startsWith('$J='));
    await until(() => jogs().length === 6, { what: 'os jogs do contorno', timeoutMs: 5_000 });
    expect(jogs()[0]).toMatch(/^\$J=G53 G90 Z-40(\.0+)? F\d+/);
    expect(jogs().slice(1).map((l) => l.match(/X(-?[\d.]+) Y(-?[\d.]+)/)!.slice(1).map(Number))).toEqual([
      [100, 100],
      [140, 100],
      [140, 120],
      [100, 120],
      [100, 100],
    ]);
    await until(() => b.state()?.machine?.state === 'Idle' && b.state()?.machine?.mpos?.z === -40, { what: 'contorno feito', timeoutMs: 15_000 });

    b.send({ type: 'jobDelete', jobId: added.jobId });
    await until(() => b.of('jobs').at(-1)?.jobs.length === 0, { what: 'apagado' });
  }, 40_000);

  it('arquivo vazio é recusado com o motivo', async () => {
    fake = new FakeFluidNC({ state: 'Idle' });
    const port = await fake.listen();
    board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board });
    wsPort = await gateway.start();
    const b = await browser();
    b.send({ type: 'jobUpload', name: 'x.nc', text: '' });
    expect(await until(() => b.of('jobAdded')[0])).toEqual({ type: 'jobAdded', ok: false, reason: 'O arquivo está vazio' });
  });
});
