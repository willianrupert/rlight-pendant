import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Board } from '../src/board';
import type { MotionSettings } from '../src/commands';
import { Gateway } from '../src/gateway';
import type { ServerMessage } from '../src/messages';
import { FakeFluidNC, type FakeOptions } from './fake-fluidnc';
import { sleep, until } from './helpers';

// De ponta a ponta: navegador ↔ servidor ↔ FluidNC falso, tudo com sockets de
// verdade e portas aleatórias.

type StateMsg = Extract<ServerMessage, { type: 'state' }>;

let fake: FakeFluidNC;
let board: Board;
let gateway: Gateway;
let wsPort: number;
const opened: WebSocket[] = [];

async function setup(
  fakeOpts: FakeOptions = { state: 'Idle', mpos: { x: 100, y: 200, z: -10 } },
  motion?: MotionSettings,
) {
  fake = new FakeFluidNC(fakeOpts);
  const port = await fake.listen();
  board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
  board.start();
  gateway = new Gateway({ board, ...(motion ? { motion } : {}) });
  wsPort = await gateway.start();
}

afterEach(async () => {
  for (const ws of opened.splice(0)) ws.terminate();
  await gateway?.close();
  board?.stop();
  await fake?.close();
});

/** Um navegador de mentira: guarda tudo o que chega. */
async function browser() {
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  opened.push(ws);
  const inbox: ServerMessage[] = [];
  const stamps: number[] = [];
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString()) as ServerMessage;
    inbox.push(m);
    if (m.type === 'state') stamps.push(Date.now());
  });
  await new Promise((r) => ws.once('open', r));
  let seq = 0;
  const of = <T extends ServerMessage['type']>(type: T) =>
    inbox.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return {
    ws,
    inbox,
    stamps,
    of,
    state: () => of('state').at(-1),
    send: (msg: object) => ws.send(JSON.stringify(msg)),
    /** Manda um comando e espera a resposta dele. */
    async command(cmd: object) {
      const id = `r${++seq}`;
      ws.send(JSON.stringify({ type: 'command', id, ...cmd }));
      return until(() => of('result').find((r) => r.id === id), { what: `resposta de ${id}` });
    },
  };
}

const live = (s: StateMsg | undefined) => s?.link.mode === 'live' && s.machine !== null;

describe('gateway: ver a máquina', () => {
  it('a tela recebe boas-vindas, o perfil e o estado da placa', async () => {
    await setup();
    const b = await browser();
    expect(b.inbox[0]).toMatchObject({ type: 'welcome', protocol: 1 });
    const profile = await until(() => b.of('profile')[0]);
    expect(profile.profile.name).toBe('CNC RLight');
    expect(profile.limits.x).toEqual({ min: 0, max: 1215 });
    const s = await until(() => live(b.state()) && b.state());
    expect(s.machine?.mpos).toEqual({ x: 100, y: 200, z: -10 });
    expect(s.link).toMatchObject({ mode: 'live', failedHop: null });
    expect(s.control).toEqual({ inControl: false, controlled: false });
  });

  it('no máximo ~10 mensagens de estado por segundo, por tela', async () => {
    await setup();
    const b = await browser();
    // Movimento manual: a placa é consultada a 10 por segundo, e há o batimento.
    await until(() => live(b.state()));
    b.send({ type: 'takeControl' });
    await until(() => b.of('control')[0]);
    await b.command({ command: 'nudge', axis: 'x', delta: 0.01 });
    const from = b.stamps.length;
    await sleep(1_000);
    const stamps = b.stamps.slice(from);
    expect(stamps.length).toBeLessThanOrEqual(11);
    expect(stamps.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]! - stamps[i - 1]!).toBeGreaterThanOrEqual(90);
  });

  it('a frequência de consulta segue quem está olhando (ADR-0001)', async () => {
    await setup();
    await until(() => board.isConnected);
    expect(board.currentPollHz).toBe(1);
    const b = await browser();
    await until(() => board.currentPollHz === 4);
    b.ws.close();
    await until(() => board.currentPollHz === 1);
  });
});

describe('gateway: a sessão de controle', () => {
  it('quem só assiste não comanda, e recebe o motivo', async () => {
    await setup();
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    const r = await b.command({ command: 'nudge', axis: 'x', delta: 1 });
    expect(r).toEqual({ type: 'result', id: 'r1', ok: false, reason: 'Outra tela está no controle' });
    expect(fake.jogs).toEqual([]);
  });

  it('assumir é explícito, e quem perde o controle fica sabendo por quê', async () => {
    await setup();
    const a = await browser();
    const b = await browser();
    a.send({ type: 'takeControl' });
    await until(() => a.of('control')[0]?.inControl);
    await until(() => b.state()?.control.controlled && !b.state()?.control.inControl);
    b.send({ type: 'takeControl' });
    await until(() => b.of('control')[0]?.inControl);
    const lost = await until(() => a.of('control').find((m) => !m.inControl));
    expect(lost).toEqual({ type: 'control', inControl: false, reason: 'Outra tela assumiu o controle' });
    await until(() => a.state()?.control.inControl === false);
  });

  it('fechar a tela larga o controle', async () => {
    await setup();
    const a = await browser();
    const b = await browser();
    a.send({ type: 'takeControl' });
    await until(() => b.state()?.control.controlled);
    a.ws.close();
    await until(() => b.state()?.control.controlled === false);
  });

  it('mensagem inválida volta com o motivo', async () => {
    await setup();
    const b = await browser();
    b.ws.send('{"type":"dance"}');
    await until(() => b.of('invalid')[0]);
    expect(b.of('invalid')[0]).toEqual({ type: 'invalid', reason: 'Tipo desconhecido: dance' });
  });
});

describe('gateway: mexer na máquina, de ponta a ponta', () => {
  it('vê a placa, assume o controle, manda a régua e vê a posição mudar', async () => {
    await setup();
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0], { what: 'placa ao vivo com perfil' });
    expect(b.state()?.machine?.mpos?.x).toBe(100);

    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);

    const r = await b.command({ command: 'nudge', axis: 'x', delta: 0.5 });
    expect(r).toEqual({ type: 'result', id: 'r1', ok: true });
    expect(fake.jogs).toEqual(['$J=G53 G90 X100.500 F1000']);

    const moved = await until(() => b.state()?.machine?.mpos?.x === 100.5 && b.state(), {
      what: 'a posição nova na tela',
    });
    expect(moved.machine?.state).toBe('Idle');
    expect(fake.mpos.x).toBe(100.5);
  });

  it('a régua acumula no alvo comandado e pesa a 2 mm da máquina', async () => {
    // Avanço baixo: a máquina fica para trás dos pedidos, como numa régua girada rápido.
    await setup(undefined, { nudgeFeedMmPerMin: 120, jogToFeedMmPerMin: 2_000 });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await b.command({ command: 'nudge', axis: 'y', delta: 0.5 }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, false, false]);
    expect(results[4]).toMatchObject({ reason: 'A régua está à frente da máquina' });
    // Todo comando leva o alvo, absoluto: repetir não faz andar a mais.
    expect(fake.jogs).toEqual([
      '$J=G53 G90 Y200.500 F120',
      '$J=G53 G90 Y201.000 F120',
      '$J=G53 G90 Y201.500 F120',
      '$J=G53 G90 Y202.000 F120',
    ]);
    await until(() => b.state()?.machine?.mpos?.y === 202 && b.state()?.machine?.state === 'Idle', {
      what: 'a máquina chega ao alvo e para',
    });
  });

  it('ir até o fantasma exige homing; depois do homing, vai', async () => {
    await setup({ state: 'Alarm', homePos: { x: 0, y: 0, z: 0 } });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);

    expect(await b.command({ command: 'jogTo', x: 10, y: 10 })).toMatchObject({
      ok: false,
      reason: 'Desbloqueie a máquina primeiro',
    });
    expect(await b.command({ command: 'home' })).toMatchObject({ ok: true });
    await until(() => b.state()?.homed && b.state()?.machine?.state === 'Idle', { what: 'homing feito' });
    expect(await b.command({ command: 'jogTo', x: 10, y: 5 })).toEqual({ type: 'result', id: 'r3', ok: true });
    await until(() => b.state()?.machine?.mpos?.x === 10 && b.state()?.machine?.mpos?.y === 5);
  });

  it('zera X, vê o WCO mudar, desfaz e vê voltar; liga o spindle e vê a rotação', async () => {
    await setup();
    fake.wco = { x: 5, y: 6, z: -7 };
    const b = await browser();
    // O WCO vem de tempos em tempos no relatório; sem ele, não há como desfazer.
    await until(() => live(b.state()) && b.of('profile')[0] && b.state()?.machine?.wco, {
      what: 'o offset atual da peça',
      timeoutMs: 5_000,
    });
    expect(b.state()?.machine?.wco).toEqual({ x: 5, y: 6, z: -7 });
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);

    expect(await b.command({ command: 'zero', axis: 'x' })).toEqual({ type: 'result', id: 'r1', ok: true, undoable: true });
    expect(fake.received).toContain('G10 L20 P0 X0');
    await until(() => b.state()?.machine?.wco?.x === 100, { what: 'o zero novo na tela' });
    expect(b.state()?.machine?.wpos?.x).toBe(0);

    expect(await b.command({ command: 'undoZero' })).toEqual({ type: 'result', id: 'r2', ok: true });
    expect(fake.received).toContain('G10 L2 P0 X5.000');
    await until(() => b.state()?.machine?.wco?.x === 5, { what: 'o zero de antes de volta' });
    expect(await b.command({ command: 'undoZero' })).toMatchObject({ ok: false, reason: 'Nada para desfazer' });

    expect(await b.command({ command: 'spindleOn', rpm: 12000 })).toEqual({ type: 'result', id: 'r4', ok: true });
    await until(() => b.state()?.machine?.spindle === 12000, { what: 'a rotação na tela' });
    expect(await b.command({ command: 'spindleOff' })).toMatchObject({ ok: true });
    await until(() => b.state()?.machine?.spindle === 0, { what: 'o spindle parado' });
    expect(fake.received.filter((l) => /^(G10|M3|M5)/.test(l))).toEqual([
      'G10 L20 P0 X0',
      'G10 L2 P0 X5.000',
      'M3 S12000',
      'M5',
    ]);
  }, 10_000);

  it('o alarme da placa chega a todas as telas', async () => {
    await setup();
    const a = await browser();
    const b = await browser();
    await until(() => live(a.state()) && live(b.state()));
    fake.alarm(1);
    await until(() => a.of('alarm')[0] && b.of('alarm')[0]);
    expect(a.of('alarm')[0]).toEqual({ type: 'alarm', code: 1 });
  });
});

describe('gateway: a conexão vai cair (ADR-0007)', () => {
  it('a queda aparece como sem sinal no trecho da máquina, e a tela volta sozinha', async () => {
    await setup();
    const b = await browser();
    await until(() => live(b.state()));
    fake.refuseConnections();
    const lost = await until(() => b.state()?.link.mode === 'no-signal' && b.state(), { what: 'sem sinal' });
    expect(lost.link.failedHop).toBe('machine');
    fake.acceptConnections();
    await until(() => live(b.state()), { what: 'de volta' });
    expect(board.sessions).toBeGreaterThanOrEqual(2);
  });

  it('sem sinal, nada é aceito e nada fica na fila para depois', async () => {
    await setup();
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);

    // A placa para de responder por mais que o limiar de 2,5 s (ADR-0007).
    fake.freeze(4_000);
    await until(() => b.state()?.link.mode === 'no-signal', { what: 'sem sinal', timeoutMs: 5_000 });
    const r = await b.command({ command: 'nudge', axis: 'x', delta: 1 });
    expect(r).toEqual({ type: 'result', id: 'r1', ok: false, reason: 'Sem sinal da máquina' });
    expect(await b.command({ command: 'jogTo', x: 1, y: 1 })).toMatchObject({ ok: false });

    // A placa derruba a conexão e volta: nada do que foi pedido chega a ela.
    fake.refuseConnections();
    await sleep(200);
    expect(await b.command({ command: 'nudge', axis: 'x', delta: 1 })).toMatchObject({
      ok: false,
      reason: 'Sem sinal da máquina',
    });
    fake.acceptConnections();
    await until(() => live(b.state()), { timeoutMs: 6_000, what: 'de volta' });
    await sleep(300);
    expect(fake.jogs).toEqual([]);
    expect(fake.mpos).toEqual({ x: 100, y: 200, z: -10 });

    // De volta, um gesto novo parte da posição real.
    const again = await b.command({ command: 'nudge', axis: 'x', delta: 1 });
    expect(again).toMatchObject({ ok: true });
    expect(fake.jogs).toEqual(['$J=G53 G90 X101.000 F1000']);
  }, 25_000);
});
