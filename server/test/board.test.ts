import { afterEach, describe, expect, it } from 'vitest';
import { Board, pollHzFor } from '../src/board';
import { FakeFluidNC } from './fake-fluidnc';
import { sleep, until } from './helpers';

// A conexão com a placa contra o FluidNC falso, com sockets de verdade.

let fake: FakeFluidNC;
let board: Board;

async function setup(opts: Partial<ConstructorParameters<typeof Board>[0]> = {}) {
  fake = new FakeFluidNC();
  const port = await fake.listen();
  board = new Board({ host: '127.0.0.1', port, pollHz: 20, backoffMs: [20, 40, 80], ...opts });
  board.start();
}

afterEach(async () => {
  board?.stop();
  await fake?.close();
});

describe('pollHzFor: a tabela do ADR-0001', () => {
  it('ninguém olhando e a máquina parada: 1 por segundo', () => {
    expect(pollHzFor({ viewers: 0, moving: false, running: false })).toBe(1);
  });
  it('alguém olhando, ou trabalho rodando: 4 por segundo', () => {
    expect(pollHzFor({ viewers: 2, moving: false, running: false })).toBe(4);
    expect(pollHzFor({ viewers: 0, moving: false, running: true })).toBe(4);
  });
  it('movimento manual: 10 por segundo', () => {
    expect(pollHzFor({ viewers: 1, moving: true, running: false })).toBe(10);
  });
});

describe('Board: leitura', () => {
  it('lê $CD a cada conexão e monta o perfil da máquina', async () => {
    await setup();
    const profile = await until(() => board.profile);
    expect(profile.name).toBe('CNC RLight');
    expect(profile.axes.z).toMatchObject({ min: -158, max: 0 });
    expect(fake.received.slice(0, 4)).toEqual(['$CD', '$I', '$G', '$#']);
  });

  it('pede ? na frequência configurada e junta os relatórios', async () => {
    await setup();
    const snap = await until(() => board.snapshot);
    expect(snap.state).toBe('Alarm');
    expect(snap.mpos).toEqual({ x: 0, y: 0, z: 0 });
    await until(() => board.snapshot?.overrides, { what: 'Ov, que vem a cada 10 relatórios' });
    expect(board.view().mode).toBe('live');
  });

  it('a frequência muda sem reconectar', async () => {
    await setup({ pollHz: 1 });
    await until(() => board.isConnected);
    const count = () => fake.received.filter((r) => r === '?').length;
    await sleep(300);
    const slow = count();
    board.setPollHz(50);
    await sleep(300);
    expect(count() - slow).toBeGreaterThan(5);
    expect(board.sessions).toBe(1);
  });

  it('as outras linhas viram mensagens tipadas', async () => {
    await setup();
    const kinds: string[] = [];
    board.on('message', (m) => kinds.push(m.kind));
    await until(() => kinds.includes('version') && kinds.includes('gcodeState') && kinds.includes('offset'));
  });
});

describe('Board: queda e reconexão (ADR-0007)', () => {
  it('reconecta sozinho quando a conexão cai, e relê a configuração', async () => {
    await setup();
    await until(() => board.profile);
    let drops = 0;
    board.on('disconnected', () => drops++);
    fake.dropConnections();
    await until(() => drops === 1);
    await until(() => board.sessions === 2 && board.isConnected);
    await until(() => fake.received.filter((r) => r === '$CD').length === 2);
    await until(() => board.view().mode === 'live');
  });

  it('continua tentando enquanto a placa recusa, e volta quando ela aceita', async () => {
    await setup();
    await until(() => board.isConnected);
    fake.refuseConnections();
    await sleep(300);
    expect(board.isConnected).toBe(false);
    expect(board.view().mode).toBe('no-signal');
    fake.acceptConnections();
    await until(() => board.isConnected && board.view().mode === 'live');
  });

  it('o intervalo entre tentativas cresce e para no teto', async () => {
    await setup({ backoffMs: [10, 40, 120] });
    await until(() => board.isConnected);
    const before = fake.attempts;
    fake.refuseConnections();
    await sleep(600);
    // 10 + 40 + 120 + 120 + 120 + 120 = 530 ms: umas 6 tentativas, não dezenas.
    const attempts = fake.attempts - before;
    expect(attempts).toBeGreaterThanOrEqual(4);
    expect(attempts).toBeLessThanOrEqual(7);
    fake.acceptConnections();
    await until(() => board.isConnected);
  });

  it('uma pausa curta da placa não derruba a conexão; só fica sem sinal', async () => {
    await setup({ deadAfterMs: 3_000 });
    await until(() => board.view().mode === 'live');
    fake.freeze(1_300);
    await until(() => board.view().mode === 'no-signal', { what: 'sem sinal durante a pausa' });
    expect(board.isConnected).toBe(true);
    await until(() => board.view().mode === 'live', { what: 'de volta depois da pausa' });
    expect(board.sessions).toBe(1);
    expect(board.view().showBack).toBe(true);
  });

  it('uma placa muda por tempo demais é dada como morta e reconectada', async () => {
    await setup({ deadAfterMs: 200 });
    await until(() => board.isConnected);
    fake.freeze(1_000);
    await until(() => board.sessions >= 2, { what: 'reconexão depois da placa muda' });
  });

  it('sem conexão, send recusa na hora em vez de guardar', async () => {
    await setup();
    await until(() => board.isConnected);
    fake.refuseConnections();
    await until(() => !board.isConnected);
    expect(board.send('$J=G53 G90 X1.000 F1000')).toBe(false);
    fake.acceptConnections();
    await until(() => board.isConnected && board.profile);
    await sleep(100);
    expect(fake.jogs).toEqual([]);
  });
});
