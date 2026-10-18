// Ponto de entrada: `npm start -w server`. A placa e a porta vêm do ambiente,
// porque o servidor conhece o endereço da placa por configuração (ADR-0001).

import { join } from 'node:path';
import { Board } from './board';
import { Gateway } from './gateway';
import { fileControlMemory } from './control';
import { fileHomingMemory } from './homing-memory';
import { fileOdometerMemory } from './odometer';

const env = process.env;
const board = new Board({
  host: env.RLIGHT_BOARD_HOST ?? '192.168.1.50',
  port: Number(env.RLIGHT_BOARD_PORT ?? 23),
});
const gateway = new Gateway({
  board,
  // RLIGHT_STATE_DIR: onde o servidor guarda o que precisa sobreviver a reinícios.
  ...(env.RLIGHT_STATE_DIR
    ? {
        homingMemory: fileHomingMemory(join(env.RLIGHT_STATE_DIR, 'homing.json')),
        controlMemory: fileControlMemory(join(env.RLIGHT_STATE_DIR, 'control.json')),
        odometerMemory: fileOdometerMemory(join(env.RLIGHT_STATE_DIR, 'odometer.json')),
      }
    : {}),
  // O fuso da oficina, para o "hoje" do hodômetro (o servidor roda em UTC).
  timeZone: env.RLIGHT_TZ ?? 'America/Sao_Paulo',
  host: env.RLIGHT_HOST ?? '127.0.0.1',
  port: Number(env.RLIGHT_PORT ?? 8787),
});

board.on('connected', () => console.log('placa: conectada'));
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
