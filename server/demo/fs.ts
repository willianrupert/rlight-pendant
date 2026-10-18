// `node:fs` para a demonstração: só a leitura das gravações da placa de
// referência que o FluidNC falso serve. Nada é gravado; na página não há disco.

import configDump from '../../core/test/fixtures/fluidnc-3.9.9/config-dump.yaml?raw';
import preamble from '../../core/test/fixtures/fluidnc-3.9.9/preamble.txt?raw';

const FILES: Record<string, string> = { 'config-dump.yaml': configDump, 'preamble.txt': preamble };

export function readFileSync(path: string | URL, _encoding?: string): string {
  const name = String(path instanceof URL ? path.pathname : path).split('/').pop() ?? '';
  const text = FILES[name];
  if (text === undefined) throw new Error(`ENOENT: ${name}`);
  return text;
}

const noDisk = (): never => {
  throw new Error('A demonstração não tem disco');
};
export const writeFileSync = noDisk;
export const mkdirSync = noDisk;
export const rmSync = noDisk;

export default { readFileSync, writeFileSync, mkdirSync, rmSync };
