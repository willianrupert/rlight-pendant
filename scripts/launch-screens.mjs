// As telas de abertura do iPhone (apple-touch-startup-image). Sem elas, o app
// da tela de início abre num flash branco antes do app escuro aparecer. Cada
// uma é só o fundo do app, na resolução exata de cada iPhone: como as telas de
// abertura dos apps nativos, sem logo nem texto (a interface aparece em seguida).
//
//   node scripts/launch-screens.mjs
//
// Escreve web/public/launch/*.png e as linhas <link> do web/index.html.
// Sem dependências: o PNG é montado à mão, com o zlib do Node.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** O fundo do app em repouso (--idle em web/src/app.css). */
const BG = [0x0d, 0x0f, 0x12];

// Largura e altura em pontos, e a densidade, de cada iPhone desde o 8.
const IPHONES = [
  [375, 667, 2], // SE (2ª e 3ª), 8
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14, 16e
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [420, 912, 3], // Air
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
];

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function solidPng(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../web/public/launch/', import.meta.url);
mkdirSync(out, { recursive: true });
const links = [];
for (const [w, h, d] of IPHONES) {
  const name = `launch-${w * d}x${h * d}.png`;
  writeFileSync(new URL(name, out), solidPng(w * d, h * d, BG));
  const media = `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: portrait)`;
  links.push(`    <link rel="apple-touch-startup-image" media="${media}" href="/launch/${name}" />`);
}

// As linhas no index.html, entre as marcas; rodar de novo substitui.
const index = new URL('../web/index.html', import.meta.url);
const html = readFileSync(index, 'utf8');
const START = '    <!-- telas de abertura: scripts/launch-screens.mjs -->';
const END = '    <!-- /telas de abertura -->';
const block = [START, ...links, END].join('\n');
const next = html.includes(START)
  ? html.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block)
  : html.replace('    <title>', `${block}\n    <title>`);
writeFileSync(index, next);
console.log(`${IPHONES.length} telas de abertura em web/public/launch/`);
