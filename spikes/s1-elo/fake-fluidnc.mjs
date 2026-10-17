#!/usr/bin/env node
// Um FluidNC falso, só para testar o s1.mjs sem a placa. Responde a '?' com um
// relatório de estado e derruba a conexão de vez em quando, como o Wi-Fi do painel.
// Uso: node fake-fluidnc.mjs [--port 2323] [--drop-every 20]

import net from 'node:net';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : def;
};
const port = opt('--port', 2323);
const dropEvery = opt('--drop-every', 0); // segundos; 0 = nunca

const server = net.createServer((sock) => {
  const born = Date.now();
  let x = 100;
  sock.write('Grbl 3.9 [FluidNC v3.9.9 (fake) \'$\' for help]\r\n');
  sock.on('data', (chunk) => {
    for (const line of chunk.toString().split(/(?=\?)|\n/)) {
      const c = line.trim();
      if (!c) continue;
      if (c === '?') {
        x += 0.25;
        sock.write(`<Idle|MPos:${x.toFixed(3)},300.000,-100.000|FS:0,0|Ov:100,100,100>\r\n`);
      } else if (c === '$I') sock.write('[VER:3.9 FluidNC v3.9.9:]\r\nok\r\n');
      else if (c === '$G') sock.write('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\nok\r\n');
      else if (c === '$#') sock.write('[G54:188.000,182.000,-105.000]\r\nok\r\n');
      else if (c === '$CD') sock.write('name: fake\r\nok\r\n');
      else sock.write('error:20\r\n');
    }
    if (dropEvery && Date.now() - born > dropEvery * 1000) sock.destroy();
  });
  sock.on('error', () => {});
});
server.listen(port, '127.0.0.1', () => console.log(`FluidNC falso em 127.0.0.1:${port}`));
