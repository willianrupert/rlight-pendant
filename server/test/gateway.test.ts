import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alarmKeepsHoming, fileHomingMemory, type HomingMemory } from '../src/homing-memory';
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
  homingMemory?: HomingMemory,
) {
  fake = new FakeFluidNC(fakeOpts);
  const port = await fake.listen();
  board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
  board.start();
  gateway = new Gateway({ board, ...(motion ? { motion } : {}), ...(homingMemory ? { homingMemory } : {}) });
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

  it('a tela que cai volta com o controle, sem tocar em nada', async () => {
    await setup();
    const a = await browser();
    const watcher = await browser();
    a.send({ type: 'takeControl', token: 'tok-a-0123456789abcdef' });
    await until(() => a.of('control')[0]?.inControl);
    a.ws.terminate();
    await sleep(100);
    expect(watcher.state()?.control.controlled).toBe(true); // reservado para a mesma tela
    const again = await browser();
    again.send({ type: 'resumeControl', token: 'tok-a-0123456789abcdef' });
    await until(() => again.of('control')[0]?.inControl);
    await until(() => live(again.state()) && again.of('profile')[0]);
    const r = await again.command({ command: 'nudge', axis: 'x', delta: 1 });
    expect(r).toMatchObject({ ok: true });
  });

  it('retomar com outro token não dá o controle, e diz que não', async () => {
    await setup();
    const a = await browser();
    a.send({ type: 'takeControl', token: 'tok-a-0123456789abcdef' });
    await until(() => a.of('control')[0]?.inControl);
    a.ws.terminate();
    const b = await browser();
    b.send({ type: 'resumeControl', token: 'tok-b-0123456789abcdef' });
    const m = await until(() => b.of('control')[0]);
    expect(m).toEqual({ type: 'control', inControl: false });
  });

  it('uma tela que parou de responder (Wi-Fi morto) é largada pelo ping, e o controle fica reservado', async () => {
    fake = new FakeFluidNC({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 } });
    const port = await fake.listen();
    board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board, pingMs: 150 });
    wsPort = await gateway.start();
    const a = await browser();
    const watcher = await browser();
    a.send({ type: 'takeControl', token: 'tok-a-0123456789abcdef' });
    await until(() => a.of('control')[0]?.inControl);
    a.ws.pause(); // não lê mais nada: os pings ficam sem resposta, como um Wi-Fi morto
    await until(() => watcher.state()?.control.inControl === false && gateway.clientCount === 1, { what: 'a tela morta largada', timeoutMs: 2_000 });
    expect(watcher.state()?.control.controlled).toBe(true); // reservado para ela voltar
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

  // O servidor só dá o homing por feito quando vê a passagem Home → Idle nos
  // relatórios (4 por segundo com uma tela aberta). Um homing de verdade leva
  // segundos; os 50 ms padrão do falso às vezes cabiam entre dois relatórios e o
  // teste falhava na CI, mais lenta. 600 ms é mais que dois intervalos.
  it('ir até o fantasma exige homing; depois do homing, vai', async () => {
    await setup({ state: 'Alarm', homePos: { x: 0, y: 0, z: 0 }, homingMs: 600 });
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

  it('o homing sobrevive a um reinício do servidor', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json');
    const memory = fileHomingMemory(file);
    await setup({ state: 'Alarm', homePos: { x: 0, y: 0, z: 0 }, homingMs: 600 }, undefined, memory);
    let b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'home' });
    await until(() => b.state()?.homed && b.state()?.machine?.state === 'Idle', { what: 'homing feito' });
    expect(memory.read()).toBe(true);

    // O servidor reinicia (uma publicação nova); a placa segue referenciada, em Idle.
    await gateway.close();
    board.stop();
    board = new Board({ host: '127.0.0.1', port: fake.port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board, homingMemory: memory });
    wsPort = await gateway.start();
    b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0], { what: 'de volta' });
    expect(b.state()?.homed).toBe(true);
  });

  it('placa em alarme ao conectar: o homing guardado é esquecido', async () => {
    const memory = fileHomingMemory(join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json'));
    memory.write(true);
    await setup({ state: 'Alarm' }, undefined, memory);
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    expect(b.state()?.homed).toBe(false);
    expect(memory.read()).toBe(false);
  });

  it('um alarme que perde a posição esquece o homing; o de soft limit não', () => {
    expect(alarmKeepsHoming(1)).toBe(false);
    expect(alarmKeepsHoming(3)).toBe(false);
    expect(alarmKeepsHoming(2)).toBe(true);
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

  it('desligar no meio do spin-up para na hora, sem esperar o spinup_ms', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 }, spinupMs: 3_000 });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    expect(await b.command({ command: 'spindleOn', rpm: 9000 })).toMatchObject({ ok: true });
    await until(() => fake.spindleOn, { what: 'o spindle acelerando' });
    const t = Date.now();
    expect(await b.command({ command: 'spindleOff' })).toMatchObject({ ok: true });
    await until(() => !fake.spindleOn, { what: 'o spindle parado', timeoutMs: 1_000 });
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(fake.received).toContain('0x18');
    expect(fake.received).not.toContain('M5');
  });

  it('trocas de rotação durante a espera não fazem fila: só a última vai', async () => {
    // Visto na máquina: cada S espera o spinup/spindown (5/10 s) e as trocas se
    // empilhavam, com a rotação na tela atrasada 6 a 8 s.
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 }, spinupMs: 800 });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'spindleOn', rpm: 6000 });
    await b.command({ command: 'spindleSpeed', rpm: 7000 });
    await b.command({ command: 'spindleSpeed', rpm: 8000 });
    expect(await b.command({ command: 'spindleSpeed', rpm: 9000 })).toMatchObject({ ok: true });
    await until(() => fake.rpm === 9000, { what: 'a última rotação', timeoutMs: 4_000 });
    expect(fake.received.filter((l) => /^(M3|S)/.test(l))).toEqual(['M3 S6000', 'S9000']);
  });

  it('desligar durante a espera de uma troca de rotação também para na hora', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 }, spinupMs: 3_000 });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    fake.spindleOn = true; // já girando, sem espera
    fake.rpm = 6000;
    await b.command({ command: 'spindleSpeed', rpm: 9000 }); // espera 3 s
    await sleep(100);
    const t = Date.now();
    await b.command({ command: 'spindleOff' });
    await until(() => !fake.spindleOn, { what: 'o spindle parado', timeoutMs: 1_000 });
    expect(Date.now() - t).toBeLessThan(1_000);
    expect(fake.received).toContain('0x18');
  });

  it('depois de um comando do spindle, a placa é lida 10 vezes por segundo, para a confirmação chegar logo', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 } });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    expect(board.currentPollHz).toBe(4);
    await b.command({ command: 'spindleOn', rpm: 6000 });
    await until(() => board.currentPollHz === 10, { what: 'leitura rápida' });
  });

  it('depois do spin-up, desligar volta a ser um M5', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 }, spinupMs: 200 });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'spindleOn', rpm: 9000 });
    await sleep(500);
    await b.command({ command: 'spindleOff' });
    await until(() => !fake.spindleOn, { what: 'o spindle parado' });
    expect(fake.received).toContain('M5');
    expect(fake.received).not.toContain('0x18');
  });

  it('a placa de toque mede o Z e zera pela espessura, com todas as telas vendo o andamento', async () => {
    const memory = fileHomingMemory(join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json'));
    memory.write(true);
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -30 }, plateZ: -40 }, undefined, memory);
    const b = await browser();
    const watcher = await browser();
    await until(() => live(b.state()) && b.of('profile')[0] && b.state()?.machine?.wco);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    expect(await b.command({ command: 'probeZ', thicknessMm: 10 })).toMatchObject({ ok: true });
    const done = await until(() => watcher.of('probe').find((m) => m.status === 'done'), { what: 'a medição', timeoutMs: 5_000 });
    expect(done.zeroMachineZ).toBe(-50);
    expect(watcher.of('probe').map((m) => m.status)).toEqual(['seeking', 'measuring', 'done']);
    await until(() => b.state()?.machine?.wco?.z === -50, { what: 'o zero novo na tela' });
    await until(() => fake.mpos.z === -35, { what: 'a fresa 5 mm acima da placa' });
  });

  it('sem placa embaixo: falha com o motivo, e nada mais é mandado', async () => {
    const memory = fileHomingMemory(join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json'));
    memory.write(true);
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -30 } }, undefined, memory);
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0] && b.state()?.machine?.wco);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'probeZ', thicknessMm: 10 });
    const failed = await until(() => b.of('probe').find((m) => m.status === 'failed'), { what: 'a falha', timeoutMs: 5_000 });
    expect(failed.reason).toBe('A fresa não encostou na placa. Aproxime mais e tente de novo.');
    expect(fake.received.filter((l) => l.startsWith('G10'))).toEqual([]);
  });

  it('uma recusa da placa chega às telas com a linha e o código', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 } });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    fake.state = 'Alarm'; // a placa travou e o servidor ainda não viu
    await b.command({ command: 'nudge', axis: 'x', delta: 1, step: 1, to: 101 });
    const e = await until(() => b.of('boardError')[0], { what: 'a recusa' });
    expect(e).toEqual({ type: 'boardError', code: 9, line: '$J=G53 G90 X101.000 F2000' });
  });

  it('o hodômetro soma o que a máquina andou e chega a quem conecta', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: -10 } });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    expect(b.of('odometer')[0]).toMatchObject({ type: 'odometer', today: { x: 0, y: 0, z: 0, spindleMs: 0 } });
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'nudge', axis: 'x', delta: 0, step: 1, to: 103 });
    await until(() => b.state()?.machine?.mpos?.x === 103 && b.state()?.machine?.state === 'Idle', { what: 'a máquina parada em 103' });
    await sleep(300);
    const later = await browser();
    const odo = await until(() => later.of('odometer')[0], { what: 'o hodômetro' });
    expect(odo.today.x).toBeCloseTo(3, 3);
    expect(odo.total.x).toBeCloseTo(3, 3);
  });

  it('salva um ponto, vai até ele e desfaz a ida: tudo de ponta a ponta', async () => {
    const memory = fileHomingMemory(join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json'));
    memory.write(true);
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: 0 } }, undefined, memory);
    const b = await browser();
    const watcher = await browser();
    await until(() => live(b.state()) && b.of('profile')[0] && b.state()?.machine?.wco);
    expect(watcher.of('points')[0]).toEqual({ type: 'points', points: [] });
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    expect(await b.command({ command: 'savePoint', name: 'Canto' })).toMatchObject({ ok: true });
    const list = await until(() => watcher.of('points').find((m) => m.points.length === 1), { what: 'a lista nova' });
    expect(list.points[0]).toMatchObject({ name: 'Canto', x: 100, y: 200, z: 0 });
    // Sai dali com o Ir, e volta ao ponto.
    await b.command({ command: 'jogTo', x: 130, y: 210 });
    await until(() => b.state()?.machine?.mpos?.x === 130 && b.state()?.machine?.state === 'Idle', { what: 'em 130', timeoutMs: 10_000 });
    expect(await b.command({ command: 'goToPoint', pointId: list.points[0]!.id })).toMatchObject({ ok: true });
    await until(() => b.state()?.machine?.mpos?.x === 100 && b.state()?.machine?.state === 'Idle', { what: 'de volta ao ponto', timeoutMs: 10_000 });
    // Desfazer a ida ao ponto leva de volta a 130.
    expect(await b.command({ command: 'undoMove' })).toMatchObject({ ok: true });
    await until(() => b.state()?.machine?.mpos?.x === 130 && b.state()?.machine?.state === 'Idle', { what: 'desfeito', timeoutMs: 10_000 });
    expect(await b.command({ command: 'undoMove' })).toMatchObject({ ok: false, reason: 'Nada para desfazer' });
    expect(await b.command({ command: 'deletePoint', pointId: list.points[0]!.id })).toMatchObject({ ok: true });
    await until(() => watcher.of('points').at(-1)?.points.length === 0, { what: 'apagado' });
  }, 15_000);

  it('quem só assiste não salva nem apaga pontos', async () => {
    await setup({ state: 'Idle', mpos: { x: 100, y: 200, z: 0 } });
    const b = await browser();
    await until(() => live(b.state()) && b.of('profile')[0]);
    expect(await b.command({ command: 'savePoint', name: 'x' })).toEqual({ type: 'result', id: 'r1', ok: false, reason: 'Outra tela está no controle' });
  });

  it('desligou com a máquina parada; religou: depois do homing, oferece voltar, e volta', async () => {
    // A máquina estava homed e parada em (120, 80, −20) antes de desligar.
    const homing = fileHomingMemory(join(mkdtempSync(join(tmpdir(), 'rlight-')), 'homing.json'));
    homing.write(true);
    let saved = { pos: { x: 120, y: 80, z: -20 }, at: 0 };
    const resume = { read: () => saved, write: (s: typeof saved) => void (saved = s) };
    fake = new FakeFluidNC({ state: 'Alarm', mpos: { x: 0, y: 0, z: 0 }, homePos: { x: 0, y: 0, z: 0 }, homingMs: 600 });
    const port = await fake.listen();
    board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board, homingMemory: homing, resumeMemory: resume });
    wsPort = await gateway.start();
    const b = await browser();
    await until(() => b.state()?.machine && b.of('profile')[0]);
    expect(b.of('resume').at(-1)?.pos ?? null).toBeNull();
    b.send({ type: 'takeControl' });
    await until(() => b.state()?.control.inControl);
    await b.command({ command: 'home' });
    const offer = await until(() => b.of('resume').find((m) => m.pos !== null), { what: 'a oferta de voltar', timeoutMs: 5_000 });
    expect(offer.pos).toEqual({ x: 120, y: 80, z: -20 });
    expect(await b.command({ command: 'resumePosition' })).toMatchObject({ ok: true });
    await until(() => b.of('resume').at(-1)?.pos === null, { what: 'a oferta usada' });
    await until(() => {
      const m = b.state()?.machine;
      return m?.state === 'Idle' && m.mpos?.x === 120 && m.mpos?.y === 80 && m.mpos?.z === -20;
    }, { what: 'de volta onde estava', timeoutMs: 10_000 });
  }, 15_000);

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
  it('servidor que nunca ouviu a placa (ligou com ela desligada): conta o tempo desde que começou a procurar', async () => {
    // Sem isto a tela ficava em "Procurando a máquina" para sempre e nunca chegava
    // a "Máquina desligada" depois de uma publicação noturna.
    fake = new FakeFluidNC({ state: 'Idle' });
    const port = await fake.listen();
    fake.refuseConnections();
    board = new Board({ host: '127.0.0.1', port, backoffMs: [20, 40, 80], deadAfterMs: 5_000 });
    board.start();
    gateway = new Gateway({ board });
    wsPort = await gateway.start();
    await sleep(300);
    const b = await browser();
    const s = await until(() => b.state(), { what: 'um estado' });
    expect(s.link).toMatchObject({ mode: 'no-signal', failedHop: 'machine' });
    expect(s.link.ageMs).toBeGreaterThanOrEqual(250);
  });

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
