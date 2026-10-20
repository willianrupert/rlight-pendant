// Ponto de entrada: `npm start -w server`. A placa e a porta vêm do ambiente,
// porque o servidor conhece o endereço da placa por configuração (ADR-0001).

import { join } from 'node:path';
import { Board } from './board';
import { Gateway } from './gateway';
import { fileControlMemory } from './control';
import { fileHomingMemory } from './homing-memory';
import { fileOdometerMemory } from './odometer';
import { filePointsMemory } from './points';
import { fileResumeMemory } from './resume';
import { noDeviceMemory } from './push';
import { JobStore } from './jobs';
import { BoardFinder, fileKnownBoardMemory, noKnownBoardMemory, scanForBoard, type KnownBoardMemory } from './discover';
import { filePushState, newVapidKeys, webPush } from './push-send';

const env = process.env;
// O endereço da placa: o da configuração, ou o que o servidor achou sozinho
// quando o roteador mudou o IP dela (discover.ts). Mudar à mão no rlight.env vence.
const configuredHost = env.RLIGHT_BOARD_HOST ?? '192.168.1.50';
const boardPort = Number(env.RLIGHT_BOARD_PORT ?? 23);
const saved = env.RLIGHT_STATE_DIR ? fileKnownBoardMemory(join(env.RLIGHT_STATE_DIR, 'board.json')) : noKnownBoardMemory;
const known: KnownBoardMemory = {
  read: () => {
    const k = saved.read();
    return k && k.configured === configuredHost ? k : null;
  },
  write: (k) => saved.write({ ...k, configured: configuredHost }),
};
const board = new Board({ host: known.read()?.host ?? configuredHost, port: boardPort });
const finder = new BoardFinder({
  board,
  memory: known,
  scan: (hosts, mac) => scanForBoard(hosts, mac, boardPort),
});
setInterval(() => void finder.tick(), 5_000);
// Os avisos no celular: as chaves nascem no primeiro uso, no RLIGHT_STATE_DIR.
// Sem ele (desenvolvimento), valem até o servidor reiniciar.
const pushState = env.RLIGHT_STATE_DIR
  ? filePushState(join(env.RLIGHT_STATE_DIR, 'push.json'))
  : { vapid: newVapidKeys(), devices: noDeviceMemory };
// Quem manda os avisos, para o serviço de push (a Apple exige um https:).
const pushSubject = env.RLIGHT_PUSH_SUBJECT ?? `https://${env.RLIGHT_DOMAIN ?? 'localhost'}`;

const gateway = new Gateway({
  board,
  push: webPush(pushState.vapid, pushSubject),
  pushDevices: pushState.devices,
  // Os trabalhos (v2): os arquivos de G-code ficam em RLIGHT_STATE_DIR/jobs.
  jobs: new JobStore(env.RLIGHT_STATE_DIR ? join(env.RLIGHT_STATE_DIR, 'jobs') : null),
  // RLIGHT_STATE_DIR: onde o servidor guarda o que precisa sobreviver a reinícios.
  ...(env.RLIGHT_STATE_DIR
    ? {
        homingMemory: fileHomingMemory(join(env.RLIGHT_STATE_DIR, 'homing.json')),
        controlMemory: fileControlMemory(join(env.RLIGHT_STATE_DIR, 'control.json')),
        odometerMemory: fileOdometerMemory(join(env.RLIGHT_STATE_DIR, 'odometer.json')),
        pointsMemory: filePointsMemory(join(env.RLIGHT_STATE_DIR, 'points.json')),
        resumeMemory: fileResumeMemory(join(env.RLIGHT_STATE_DIR, 'resume.json')),
      }
    : {}),
  // O fuso da oficina, para o "hoje" do hodômetro (o servidor roda em UTC).
  timeZone: env.RLIGHT_TZ ?? 'America/Sao_Paulo',
  host: env.RLIGHT_HOST ?? '127.0.0.1',
  port: Number(env.RLIGHT_PORT ?? 8787),
});

board.on('connected', () => console.log(`placa: conectada em ${board.host}`));
board.on('disconnected', () => console.log('placa: caiu, tentando de novo'));
board.start();
const port = await gateway.start();
console.log(`RLight ouvindo em ws://${env.RLIGHT_HOST ?? '127.0.0.1'}:${port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    board.stop();
    await gateway.close();
    process.exit(0);
  });
}
