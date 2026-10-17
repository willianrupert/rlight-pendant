#!/usr/bin/env node
// Spike S1: o elo servidor → placa. Conecta ao FluidNC pela porta telnet (TCP 23),
// pede o relatório de estado na frequência escolhida e registra tudo por um tempo.
// SOMENTE LEITURA: só sai da lista READ_ONLY abaixo. Nenhum movimento, nenhum spindle,
// nenhuma configuração é alterada.
//
// Uso: node s1.mjs <host> [--port 23] [--hz 10] [--minutes 60] [--out ./saida]

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const READ_ONLY = new Set(['?', '$I', '$G', '$#', '$CD', '$SS']);

function parseArgs(argv) {
  const args = { host: null, port: 23, hz: 10, minutes: 60, out: './saida' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--hz') args.hz = Number(argv[++i]);
    else if (a === '--minutes') args.minutes = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (!a.startsWith('--')) args.host = a;
  }
  if (!args.host) {
    console.error('Uso: node s1.mjs <host> [--port 23] [--hz 10] [--minutes 60] [--out ./saida]');
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(args.out, `s1-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
const fixture = fs.createWriteStream(path.join(outDir, 'trafego.jsonl'));

const t0 = Date.now();
const now = () => Date.now() - t0;
const stats = {
  host: args.host,
  port: args.port,
  hz: args.hz,
  startedAt: new Date(t0).toISOString(),
  connects: 0,
  drops: [], // { at, durationMs }
  statusReports: 0,
  gapsOver2s: [], // { at, gapMs }
  latencies: [], // ms entre '?' e o relatório
  fields: {}, // campo do relatório → quantas vezes
  states: {}, // estado → quantas vezes
  otherLines: 0,
  errors: [],
};

function record(dir, line) {
  fixture.write(JSON.stringify({ t: now(), dir, line }) + '\n');
}

function send(sock, cmd) {
  if (!READ_ONLY.has(cmd)) throw new Error(`Comando fora da lista somente leitura: ${cmd}`);
  // '?' é um caractere de tempo real: vai sem quebra de linha.
  sock.write(cmd === '?' ? '?' : `${cmd}\n`);
  record('out', cmd);
}

let lastStatusAt = null;
const pendingQueries = [];

function onStatus(line) {
  stats.statusReports++;
  const t = now();
  if (lastStatusAt !== null && t - lastStatusAt > 2000) stats.gapsOver2s.push({ at: t, gapMs: t - lastStatusAt });
  lastStatusAt = t;
  const sent = pendingQueries.shift();
  if (sent !== undefined) stats.latencies.push(t - sent);
  const body = line.slice(1, line.lastIndexOf('>'));
  const [state, ...parts] = body.split('|');
  const base = state.split(':')[0];
  stats.states[base] = (stats.states[base] ?? 0) + 1;
  for (const p of parts) {
    const key = p.split(':')[0];
    stats.fields[key] = (stats.fields[key] ?? 0) + 1;
  }
}

function onLine(line) {
  record('in', line);
  if (line.startsWith('<') && line.includes('>')) onStatus(line);
  else stats.otherLines++;
}

let sock = null;
let poll = null;
let lostAt = null;
let backoff = 500;
let finished = false;

function connect() {
  if (finished) return;
  sock = net.createConnection({ host: args.host, port: args.port });
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 1000);
  let buf = '';
  sock.on('connect', () => {
    stats.connects++;
    if (lostAt !== null) {
      stats.drops.push({ at: lostAt, durationMs: now() - lostAt });
      lostAt = null;
    }
    backoff = 500;
    record('event', 'connected');
    console.log(`[${(now() / 1000).toFixed(1)} s] conectado a ${args.host}:${args.port}`);
    // Uma vez por conexão: quem é a placa e como ela está configurada.
    for (const c of ['$I', '$G', '$#', '$CD']) send(sock, c);
    pendingQueries.length = 0;
    poll = setInterval(() => {
      pendingQueries.push(now());
      if (pendingQueries.length > 20) pendingQueries.shift();
      send(sock, '?');
    }, Math.round(1000 / args.hz));
  });
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.search(/\r?\n/)) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(buf[i] === '\r' ? i + 2 : i + 1);
      if (line) onLine(line);
    }
  });
  let dead = false;
  const lost = (why) => {
    // 'error' costuma vir seguido de 'close': uma queda, uma reconexão.
    if (dead) return;
    dead = true;
    if (poll) clearInterval(poll);
    poll = null;
    if (finished) return;
    if (lostAt === null) lostAt = now();
    record('event', `lost: ${why}`);
    console.log(`[${(now() / 1000).toFixed(1)} s] conexão perdida (${why}); nova tentativa em ${backoff} ms`);
    setTimeout(connect, backoff);
    backoff = Math.min(5000, backoff * 2);
  };
  sock.on('error', (e) => {
    stats.errors.push({ at: now(), message: e.message });
    lost(e.code ?? e.message);
  });
  sock.on('close', () => lost('close'));
  // Sem relatório por 2 s com a conexão "aberta": trata como queda.
  sock.setTimeout(2000, () => sock.destroy(new Error('sem dados por 2 s')));
}

function pct(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function finish() {
  if (finished) return;
  finished = true;
  if (poll) clearInterval(poll);
  if (lostAt !== null) stats.drops.push({ at: lostAt, durationMs: now() - lostAt, open: true });
  sock?.destroy();
  const minutes = now() / 60000;
  const summary = {
    ...stats,
    durationMin: Number(minutes.toFixed(2)),
    reportsPerSecond: Number((stats.statusReports / (now() / 1000)).toFixed(2)),
    dropsPerHour: Number((stats.drops.length / (minutes / 60)).toFixed(2)),
    latencyMs: { p50: pct(stats.latencies, 50), p95: pct(stats.latencies, 95), max: pct(stats.latencies, 100) },
    latencies: undefined,
    criterio: {
      // 95 % da frequência pedida, para descontar a variação normal do temporizador.
      [`relatórios ≥ ${(args.hz * 0.95).toFixed(1)}/s`]: stats.statusReports / (now() / 1000) >= args.hz * 0.95,
      'nenhuma lacuna > 2 s': stats.gapsOver2s.length === 0,
      'reconectou sozinho em todas as quedas': stats.drops.every((d) => !d.open),
      'quedas por hora ≤ 1': stats.drops.length / (minutes / 60) <= 1,
    },
  };
  fs.writeFileSync(path.join(outDir, 'resumo.json'), JSON.stringify(summary, null, 2));
  fixture.end();
  console.log('\nResumo:');
  console.log(JSON.stringify({ ...summary, fields: summary.fields, states: summary.states }, null, 2));
  console.log(`\nArquivos em ${outDir}`);
  process.exit(0);
}

process.on('SIGINT', finish);
setTimeout(finish, args.minutes * 60_000);
connect();
