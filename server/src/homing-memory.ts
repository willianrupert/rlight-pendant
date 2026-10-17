// O homing sobrevive a reinícios do servidor. Antes, cada publicação reiniciava o
// servidor e ele "esquecia" um homing feito minutos antes: o fantasma ficava
// bloqueado com a máquina perfeitamente referenciada (visto no iPhone em
// 2026-10-17). O servidor guarda que viu o homing e só esquece por motivo real:
// placa em alarme ao conectar (pode ter reiniciado) ou um alarme que perde a posição.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface HomingMemory {
  read(): boolean;
  write(homed: boolean): void;
}

/** Sem memória: o comportamento de antes, para testes e para quem não configurar. */
export const noHomingMemory: HomingMemory = { read: () => false, write: () => {} };

export function fileHomingMemory(path: string): HomingMemory {
  return {
    read() {
      try {
        return (JSON.parse(readFileSync(path, 'utf8')) as { homed?: unknown }).homed === true;
      } catch {
        return false;
      }
    },
    write(homed) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ homed, at: new Date().toISOString() }) + '\n');
      } catch {
        // Sem onde gravar: o servidor segue, só não lembra depois de reiniciar.
      }
    },
  };
}

/**
 * Alarmes que não perdem a posição: o 2 (soft limit) barra o movimento antes de
 * ele acontecer. Os outros (fim de curso, reset em movimento, homing que falhou)
 * pedem um homing novo.
 */
export function alarmKeepsHoming(code: number): boolean {
  return code === 2;
}
