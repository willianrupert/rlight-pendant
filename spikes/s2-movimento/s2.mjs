#!/usr/bin/env node
// Spike S2 (ADR-0002): o movimento por intenções completas é exato e seguro com a
// rede caindo? O script age como o app: conecta ao servidor do RLight, assume o
// controle e manda os mesmos comandos. Tudo dentro de uma caixa segura, no ar.
//
// Uso: node s2.mjs [--server ws://127.0.0.1:8787] [--vezes 10]
// Requer Node 22+ (WebSocket nativo). Ctrl+C: manda cancelJog e sai.

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const SERVER = arg('--server', 'ws://127.0.0.1:8787');
const VEZES = Number(arg('--vezes', 10));
// Caixa segura em coordenadas de máquina: a mesma área do percurso no ar de 2026-10-17.
const BOX = { x: [300, 550], y: [200, 320], z: [-10, -2] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() { this.state = null; this.results = new Map(); this.seq = 0; this.waiters = []; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(SERVER);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('não conectou ao servidor'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'state') { this.state = m; this.stateAt = performance.now(); for (const w of this.waiters) w(); }
        if (m.type === 'result' && m.id) this.results.set(m.id, m);
      };
    });
  }
  close() { this.ws?.close(); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async cmd(c) {
    const id = `s${++this.seq}`;
    this.send({ type: 'command', id, ...c });
    const t0 = performance.now();
    while (!this.results.has(id)) { if (performance.now() - t0 > 3000) throw new Error(`sem resposta para ${c.command}`); await sleep(5); }
    return this.results.get(id);
  }
  get m() { return this.state?.machine; }
  async until(pred, ms = 20000, what = 'condição') {
    const t0 = performance.now();
    while (!(this.state && pred(this.state))) { if (performance.now() - t0 > ms) throw new Error(`tempo esgotado: ${what}`); await sleep(10); }
  }
}

const near = (a, b, tol = 0.011) => Math.abs(a - b) <= tol;
let c = new Client();
const stopAll = async () => { try { c.send({ type: 'command', command: 'cancelJog' }); } catch {} await sleep(200); process.exit(1); };
process.on('SIGINT', stopAll);

async function connect() {
  c = new Client();
  await c.open();
  await c.until((s) => s.link.mode === 'live' && s.machine, 10000, 'estado ao vivo');
  c.send({ type: 'takeControl' });
  await c.until((s) => s.control.inControl, 5000, 'controle');
}
const idle = () => c.until((s) => s.machine.state === 'Idle', 30000, 'parar (Idle)');

// Espera a posição chegar de fato: um Idle antigo, de antes do jog, não vale.
const arrived = (x, y, z) =>
  c.until((s) => s.machine.state === 'Idle' && near(s.machine.mpos.x, x) && near(s.machine.mpos.y, y) && near(s.machine.mpos.z, z), 60000, `chegar em ${x}, ${y}, ${z}`);

async function goSafe(x, y, z) {
  const p = c.m.mpos;
  if (!near(p.z, z)) { await c.cmd({ command: 'jogAxisTo', axis: 'z', value: z }); await arrived(p.x, p.y, z); }
  await c.cmd({ command: 'jogTo', x, y });
  await arrived(x, y, z);
}

const report = {};
async function main() {
  await connect();
  if (!c.state.homed || c.m.state === 'Alarm') {
    // O servidor só confia no homing que ele mesmo viu (depois de um $X não há como saber).
    console.log('fazendo o homing pelo servidor...');
    const r = await c.cmd({ command: 'home' });
    if (!r.ok) throw new Error(`homing recusado: ${r.reason}`);
    await c.until((s) => s.homed && s.machine.state === 'Idle', 90000, 'homing terminar');
  }
  const m = c.m;
  if (m.state !== 'Idle') throw new Error(`a máquina precisa estar em Idle (está ${m.state})`);
  console.log(`conectado · ${m.state} · X ${m.mpos.x} Y ${m.mpos.y} Z ${m.mpos.z}`);
  console.log('indo para o início da caixa segura (Z −5, depois X 320 Y 210)...');
  await goSafe(320, 210, -5);

  // A · Parar: cancelJog interrompe em ≤ 0,3 s.
  const stops = [];
  for (let i = 0; i < VEZES; i++) {
    const from = i % 2 ? { x: 540, y: 310 } : { x: 320, y: 210 };
    const to = i % 2 ? { x: 320, y: 210 } : { x: 540, y: 310 };
    await goSafe(from.x, from.y, -5);
    await c.cmd({ command: 'jogTo', ...to });
    await c.until((s) => s.machine.state === 'Jog', 3000, 'começar a mover');
    await sleep(900);
    const t0 = performance.now();
    await c.cmd({ command: 'cancelJog' });
    await idle();
    stops.push(performance.now() - t0);
    process.stdout.write(`A${i + 1}:${Math.round(stops[i])}ms `);
  }
  report.parar = { ms: stops.map(Math.round), max: Math.round(Math.max(...stops)), aprova: Math.max(...stops) <= 300 + 150 };
  console.log();

  // B · Queda durante o deslocamento ao fantasma: termina exatamente no destino.
  const dropsB = [];
  for (let i = 0; i < VEZES; i++) {
    const to = i % 2 ? { x: 320, y: 210 } : { x: 540, y: 310 };
    await goSafe(i % 2 ? 540 : 320, i % 2 ? 310 : 210, -5);
    await c.cmd({ command: 'jogTo', ...to });
    await c.until((s) => s.machine.state === 'Jog', 3000, 'começar a mover');
    await sleep(700);
    c.close(); // o celular some
    await sleep(500);
    await connect(); // e volta
    await idle();
    await sleep(1500);
    const p = c.m.mpos;
    const ok = near(p.x, to.x) && near(p.y, to.y);
    dropsB.push({ x: p.x, y: p.y, ok });
    process.stdout.write(`B${i + 1}:${ok ? 'ok' : 'FALHOU'} `);
  }
  report.quedaFantasma = { aprova: dropsB.every((d) => d.ok), finais: dropsB };
  console.log();

  // C · Queda durante a régua: não passa do alvo comandado.
  const dropsC = [];
  for (let i = 0; i < VEZES; i++) {
    await goSafe(400, 250, -5);
    const start = c.m.mpos.x;
    let target = start;
    for (let k = 0; k < 8; k++) {
      const r = await c.cmd({ command: 'nudge', axis: 'x', delta: 0.5 });
      if (r.ok) target = Math.round((target + 0.5) * 1000) / 1000;
    }
    c.close();
    await sleep(500);
    await connect();
    await idle();
    await sleep(1000);
    const x = c.m.mpos.x;
    const ok = x <= target + 0.011 && target - start <= 2.0 + 0.011;
    dropsC.push({ start, target, final: x, ok });
    process.stdout.write(`C${i + 1}:${ok ? 'ok' : 'FALHOU'}(${(target - start).toFixed(1)}mm) `);
  }
  report.quedaRegua = { aprova: dropsC.every((d) => d.ok), finais: dropsC };
  console.log();

  // D · Comando duplicado: reenviar o mesmo destino não move a máquina.
  await goSafe(400, 250, -5);
  await c.cmd({ command: 'jogAxisTo', axis: 'x', value: 420 });
  await c.cmd({ command: 'jogAxisTo', axis: 'x', value: 420 });
  await arrived(420, 250, -5); await sleep(800);
  report.duplicado = { final: c.m.mpos.x, aprova: near(c.m.mpos.x, 420) };

  console.log('\nResultado do S2:');
  console.log(JSON.stringify(report, null, 2));
  const all = [report.parar, report.quedaFantasma, report.quedaRegua, report.duplicado].every((r) => r.aprova);
  console.log(all ? '\nS2 APROVADO' : '\nS2 REPROVADO em algum critério');
  c.send({ type: 'releaseControl' });
  await sleep(200);
  process.exit(all ? 0 : 2);
}

main().catch(async (e) => { console.error('\nParou:', e.message); await stopAll(); });
