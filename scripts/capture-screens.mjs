#!/usr/bin/env node
// Captura as telas do app para o README, com um Chrome headless controlado pelo
// protocolo de depuração (sem dependências). O app roda contra o simulador quieto:
//
//   RLIGHT_PORT=8788 RLIGHT_SIM_QUIET=1 npm run sim
//   (cd web && RLIGHT_SERVER=ws://127.0.0.1:8788 npx vite --port 5181)
//   node scripts/capture-screens.mjs
//
// Gera PNGs de iPhone (390×844 a 3×) em docs/images/.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.APP_URL ?? 'http://localhost:5181';
const SERVER = process.env.SERVER_WS ?? 'ws://127.0.0.1:8788';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL('../docs/images/', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// ── Um cliente do servidor, para preparar as cenas ───────────────────────────
class Server {
  constructor() { this.state = null; this.n = 0; this.res = {}; }
  async open() {
    this.ws = new WebSocket(SERVER);
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'state') this.state = m; if (m.type === 'result') this.res[m.id] = m; };
    await new Promise((ok) => (this.ws.onopen = ok));
    await this.until((s) => s.machine && s.link.mode === 'live');
  }
  async until(p, ms = 60000) { const t = Date.now(); while (!(this.state && p(this.state))) { if (Date.now() - t > ms) throw new Error('tempo esgotado'); await sleep(50); } }
  async cmd(c) { const id = `s${++this.n}`; this.ws.send(JSON.stringify({ type: 'command', id, ...c })); while (!this.res[id]) await sleep(10); return this.res[id]; }
  take() { this.ws.send(JSON.stringify({ type: 'takeControl' })); return this.until((s) => s.control.inControl); }
  release() { this.ws.send(JSON.stringify({ type: 'releaseControl' })); }
}

// ── Chrome pelo protocolo de depuração ───────────────────────────────────────
async function chrome() {
  const port = 9333;
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rlight-cap-'))}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(100); }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => (ws.onopen = ok));
  let id = 0; const pending = {};
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } };
  const send = (method, params = {}) => new Promise((ok) => { const i = ++id; pending[i] = ok; ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: () => { ws.close(); proc.kill(); } };
}

async function main() {
  const srv = new Server();
  await srv.open();
  console.log('preparando: homing e ponto de partida');
  await srv.take();
  if (!srv.state.homed) { await srv.cmd({ command: 'home' }); await srv.until((s) => s.homed && s.machine.state === 'Idle'); }
  await srv.cmd({ command: 'jogTo', x: 120, y: 90 });
  await srv.until((s) => s.machine.state === 'Idle' && Math.abs(s.machine.mpos.x - 120) < 0.01);
  srv.release();

  const { send, close } = await chrome();
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Page.enable');
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64')); console.log('  ✓', name); };
  const tap = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };

  await send('Page.navigate', { url: APP });
  await sleep(2500);

  // 1. Quem só assiste: a máquina atravessando a mesa.
  await srv.take();
  await srv.cmd({ command: 'jogTo', x: 1100, y: 520 });
  srv.release();
  await sleep(1800);
  await shot('01-assistir');

  // 2. Com o controle: o mapa com a velocidade real, a régua e o seletor de passo.
  await js(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('Assumir o controle'))?.click()`);
  await sleep(1500);
  await shot('02-controle');

  // 3. Parada, um toque na mesa: o fantasma, a linha e o "Ir".
  await srv.until((s) => s.machine.state === 'Idle', 60000);
  await sleep(1200);
  const r = await js(`(() => { const b = document.querySelector('.map svg').getBoundingClientRect(); return { x: b.left + b.width * 0.32, y: b.top + b.height * 0.62 }; })()`);
  await tap(r.x, r.y);
  await sleep(900);
  await shot('03-fantasma');

  // 4. A folha do spindle.
  await tap(r.x, r.y - 400 > 0 ? 40 : 40); // um toque fora do mapa desfaz a prévia
  await sleep(300);
  await js(`document.querySelector('button[aria-label="Spindle"]')?.click()`);
  await sleep(1200);
  await shot('04-spindle');

  close();
  srv.ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
