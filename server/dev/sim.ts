// Modo simulador: `npm run sim`. Sobe um FluidNC falso, o servidor de verdade e
// um "operador fantasma" que manda jogs de vez em quando, para a tela ter vida
// durante o desenvolvimento. Nada aqui fala com uma placa real.

import net from 'node:net';
import { Board } from '../src/board';
import { join } from 'node:path';
import { fileControlMemory } from '../src/control';
import { Gateway } from '../src/gateway';
import { fileHomingMemory } from '../src/homing-memory';
import { fileOdometerMemory } from '../src/odometer';
import { filePointsMemory } from '../src/points';
import { fileResumeMemory } from '../src/resume';
import { noDeviceMemory } from '../src/push';
import { filePushState, newVapidKeys, webPush } from '../src/push-send';
import { FakeFluidNC } from '../test/fake-fluidnc';

// O spin-up de 5 s é o da máquina de referência (spinup_ms): o M3 só responde depois dele.
// RLIGHT_SIM_POWER_ON=1: a placa começa em alarme, como recém-ligada (must_home).
const fake = new FakeFluidNC({
  state: process.env.RLIGHT_SIM_POWER_ON ? 'Alarm' : 'Idle',
  mpos: { x: 412.3, y: 118.05, z: -3.2 },
  homingMs: 3_000,
  spinupMs: Number(process.env.RLIGHT_SIM_SPINUP_MS ?? 5_000),
  // A placa de toque do simulador: a fresa encosta nela em Z −60 de máquina.
  plateZ: Number(process.env.RLIGHT_SIM_PLATE_Z ?? -60),
  probeMaxMs: 2_500,
});
const boardPort = await fake.listen(Number(process.env.RLIGHT_SIM_PORT ?? 0));

const board = new Board({ host: '127.0.0.1', port: boardPort });
const stateDir = process.env.RLIGHT_STATE_DIR;
// Os avisos de verdade, também no simulador (chegam no celular se o app instalado apontar para cá).
const pushState = stateDir ? filePushState(join(stateDir, 'push.json')) : { vapid: newVapidKeys(), devices: noDeviceMemory };
const gateway = new Gateway({
  board,
  push: webPush(pushState.vapid, process.env.RLIGHT_PUSH_SUBJECT ?? 'https://localhost'),
  pushDevices: pushState.devices,
  // Como no servidor de verdade: o que precisa sobreviver a reinícios fica no RLIGHT_STATE_DIR.
  ...(stateDir
    ? {
        controlMemory: fileControlMemory(join(stateDir, 'control.json')),
        homingMemory: fileHomingMemory(join(stateDir, 'homing.json')),
        odometerMemory: fileOdometerMemory(join(stateDir, 'odometer.json')),
        pointsMemory: filePointsMemory(join(stateDir, 'points.json')),
        resumeMemory: fileResumeMemory(join(stateDir, 'resume.json')),
      }
    : {}),
  host: process.env.RLIGHT_HOST ?? '0.0.0.0',
  port: Number(process.env.RLIGHT_PORT ?? 8787),
});
board.start();
const port = await gateway.start();
console.log(`simulador: FluidNC falso em 127.0.0.1:${boardPort}`);
console.log(`simulador: RLight ouvindo em ws://0.0.0.0:${port}`);

// O operador fantasma: uma segunda conexão com a placa falsa, como a WebUI.
const ghost = net.createConnection({ host: '127.0.0.1', port: boardPort });
ghost.on('error', () => {});
const r = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 1000) / 1000;
// RLIGHT_SIM_QUIET=1: sem operador fantasma e sem pausas, para testes como o
// spike S2.
const quiet = process.env.RLIGHT_SIM_QUIET === '1';
let tick = 0;
if (!quiet) setInterval(() => {
  tick++;
  if (tick % 3 === 0) ghost.write(`$J=G53 G90 Z${r(-20, -1).toFixed(3)} F600\n`);
  else ghost.write(`$J=G53 G90 X${r(50, 1150).toFixed(3)} Y${r(30, 570).toFixed(3)} F2500\n`);
}, 4_000);

// De tempos em tempos, uma pausa como as do Wi-Fi da placa (spike S1).
if (!quiet) setInterval(() => fake.freeze(1_400), 37_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    ghost.destroy();
    board.stop();
    await gateway.close();
    await fake.close();
    process.exit(0);
  });
}
