// Utilidades dos testes de integração: esperar uma condição sem relógio falso,
// porque aqui há sockets de verdade.

import net from 'node:net';

export async function until<T>(
  check: () => T | undefined | null | false,
  { timeoutMs = 3_000, everyMs = 5, what = 'condição' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um cliente telnet cru, para conversar com o FluidNC falso direto. */
export async function rawClient(port: number) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  const lines: string[] = [];
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(buf.slice(0, i).replace(/\r$/, ''));
      buf = buf.slice(i + 1);
    }
  });
  return {
    sock,
    lines,
    send: (s: string) => sock.write(s),
    close: () => sock.destroy(),
  };
}
