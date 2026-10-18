// A demonstração pública (GitHub Pages): o FluidNC falso, a placa e o portão do
// servidor de verdade, todos dentro da página. A build de demonstração troca
// `node:net`, `ws` e `node:fs` pelos canos em memória daqui (web/vite.config.ts);
// a lógica do servidor e do core é a mesma da máquina. Nada sai da página.

import { Board } from '../src/board';
import { Gateway } from '../src/gateway';
import type { HomingMemory } from '../src/homing-memory';
import { FakeFluidNC } from '../test/fake-fluidnc';
import { bytes } from './net';
import { connectClient, type ClientSocket } from './ws';

const BOARD_PORT = 23;
const GATEWAY_PORT = 8787;

export interface DemoOptions {
  /** O spin-up da máquina de referência é 5 s (server/dev/sim.ts). */
  spinupMs?: number;
  homingMs?: number;
}

export interface Demo {
  /** Uma tela nova conectada ao portão. */
  open(): ClientSocket;
  stop(): Promise<void>;
}

// Quem visita a demonstração quer mexer logo: a máquina simulada já começa
// referenciada, em vez de pedir um homing antes do primeiro Ir.
const startsHomed: HomingMemory = { read: () => true, write: () => {} };

export function startDemo(options: DemoOptions = {}): Demo {
  installBuffer();
  const fake = new FakeFluidNC({
    state: 'Idle',
    mpos: { x: 412.3, y: 118.05, z: -3.2 },
    homingMs: options.homingMs ?? 3_000,
    spinupMs: options.spinupMs ?? 5_000,
  });
  void fake.listen(BOARD_PORT);
  const board = new Board({ host: 'fluidnc.demo', port: BOARD_PORT });
  const gateway = new Gateway({ board, port: GATEWAY_PORT, homingMemory: startsHomed });
  board.start();
  void gateway.start();
  return {
    open: () => connectClient(GATEWAY_PORT),
    async stop() {
      board.stop();
      await gateway.close();
      await fake.close();
    },
  };
}

let running: Demo | null = null;

/** Para a Connection da tela: a primeira conexão liga o simulador. */
export function openDemoSocket(_url: string): ClientSocket {
  running ??= startDemo();
  return running.open();
}

/** A placa manda os bytes de tempo real com Buffer.from; no navegador, um pedaço basta. */
function installBuffer(): void {
  const g = globalThis as { Buffer?: unknown };
  g.Buffer ??= { from: (data: string | ArrayLike<number>) => bytes(data) };
}
